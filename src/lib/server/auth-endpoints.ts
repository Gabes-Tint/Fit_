import { json } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { apiError, readTextBody, retryAfter } from './api';
import { clientAddressFor } from './client-address';
import { deviceLabelFrom } from './device-label';
import { sessionTokenFrom } from './request-auth';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session-cookie';
import type { SessionCookieWriter } from './session-cookie';
import { authenticate, membershipsFor, registerAccount } from './users/accounts';
import { OWASP_SCRYPT } from './users/password';
import type { ScryptCost } from './users/password';
import { createSession, endAllSessions, endSession } from './users/sessions';
import {
	checkRegistration,
	checkSignIn,
	clearSignInFailures,
	recordFailedSignIn,
	recordRegistration
} from './users/throttle';
import type { Account } from './users/types';

/**
 * The public authentication endpoints. They live here rather than in
 * `+server.ts` because this module is what the `server` vitest project measures
 * and mutates; each route is a one-line wrapper supplying the process-wide
 * database, and everything below takes it as an argument so a spec can hand it
 * an in-memory one.
 */

/**
 * The part of SvelteKit's `RequestEvent` these handlers use, on purpose narrow:
 * a spec can build one without the framework, and nothing here can quietly start
 * depending on the rest of the event.
 */
export type AuthEvent = {
	request: Request;
	url: URL;
	cookies: SessionCookieWriter & Pick<Cookies, 'get'>;
	locals: App.Locals;
	getClientAddress: () => string;
};

/**
 * How the client wants its session back. The web build gets the `HttpOnly`
 * cookie and no token in the body — a body token would hand every script on the
 * page the credential the cookie exists to hide. The Capacitor build has no
 * usable cookie jar for a remote origin and asks for a token instead, sent as
 * `Authorization: Bearer`. A request never carries both.
 */
export const SESSION_DELIVERY_HEADER = 'x-fit-session';

const BEARER_DELIVERY = 'bearer';

function wantsBearerSession(request: Request): boolean {
	return request.headers.get(SESSION_DELIVERY_HEADER)?.trim().toLowerCase() === BEARER_DELIVERY;
}

/**
 * Start a session and answer with it. `households` is in the body because
 * `household_id` is the predicate every later read filters on, so a fresh
 * client has nothing else to ask for. `expiresAt` tells the client when to stop
 * trusting what it holds, without decoding anything.
 *
 * The session is labelled from the request's own `User-Agent`, not from
 * anything the form asked for — see `device-label.ts`.
 */
function establishSession(
	db: DatabaseSync,
	event: AuthEvent,
	account: Account,
	status: number
): Response {
	const deviceLabel = deviceLabelFrom(event.request.headers.get('user-agent'));
	const { token, session } = createSession(db, account.id, deviceLabel);
	const body = {
		account,
		households: membershipsFor(db, account.id),
		expiresAt: session.expiresAt
	};
	if (wantsBearerSession(event.request)) {
		return json({ ...body, token }, { status });
	}
	setSessionCookie(event.cookies, event.url, { token, expiresAt: session.expiresAt });
	return json(body, { status });
}

/**
 * Registration is the one place that answers "does this username exist": a
 * sign-up form must say when a name is taken. Sign-in says nothing of the sort;
 * one who can tell a wrong name from a wrong password has halved the problem.
 */
function registrationError(problem: { field: string; code: string }): Response {
	if (problem.code === 'taken') return apiError('username-taken', { field: problem.field });
	return apiError('invalid-input', { field: problem.field, reason: problem.code });
}

/**
 * Create an account, its household and its own profile, then sign it in. The
 * four rows go in one transaction inside `registerAccount`; this only decides
 * what the caller is told.
 *
 * `cost` is injected as `registerAccount` takes it, so a spec need not hash at
 * the production cost.
 *
 * Throttled on the address before anything is derived, in the order sign-in
 * uses: without it this is a 350 ms CPU sink and a free `username-taken` oracle.
 * The attempt is counted whether or not an account results, so probing a name
 * costs exactly what registering one does.
 */
export async function register(
	db: DatabaseSync,
	event: AuthEvent,
	cost: ScryptCost = OWASP_SCRYPT
): Promise<Response> {
	const fields = await readTextBody(event.request);
	if (fields === null) return apiError('invalid-body');
	const clientAddress = clientAddressFor(event.request, event.getClientAddress);
	const decision = checkRegistration(db, clientAddress);
	if (!decision.allowed)
		return apiError('too-many-attempts', {}, retryAfter(decision.retryAfterMs));
	recordRegistration(db, clientAddress);
	const result = await registerAccount(
		db,
		{
			username: fields['username'] ?? '',
			displayName: fields['displayName'] ?? '',
			password: fields['password'] ?? '',
			householdName: fields['householdName'] ?? ''
		},
		cost
	);
	if (!result.ok) return registrationError(result.problem);
	return establishSession(db, event, result.account, 201);
}

/**
 * Sign in, in the order the throttle requires. `checkSignIn` runs before
 * `authenticate` so a locked attempt costs a hash lookup, not 350 ms of scrypt;
 * the failure is counted before the answer and cleared only once the password is
 * proved.
 *
 * Every failure answers `invalid-credentials` and nothing else: an unknown
 * username, a wrong password and a malformed one share the same status, body and
 * — via a decoy hash — near the same duration. The username is the only
 * identifier, so a caller who could tell those apart would have halved the
 * problem.
 *
 * A lockout is not an oracle either: the throttle keys on the username as
 * submitted, existing or not, so a wait says only what the caller has already
 * done.
 */
export async function signIn(
	db: DatabaseSync,
	event: AuthEvent,
	cost: ScryptCost = OWASP_SCRYPT
): Promise<Response> {
	const fields = await readTextBody(event.request);
	if (fields === null) return apiError('invalid-body');
	const attempt = {
		username: fields['username'] ?? '',
		clientAddress: clientAddressFor(event.request, event.getClientAddress)
	};
	const decision = checkSignIn(db, attempt);
	if (!decision.allowed)
		return apiError('too-many-attempts', {}, retryAfter(decision.retryAfterMs));
	const account = await authenticate(db, attempt.username, fields['password'] ?? '', { cost });
	if (account === null) {
		recordFailedSignIn(db, attempt);
		return apiError('invalid-credentials');
	}
	clearSignInFailures(db, attempt.username);
	return establishSession(db, event, account, 200);
}

/**
 * What the caller's own session is, for the client holding it. The browser
 * cannot read its own `HttpOnly` cookie, so it cannot tell whether that session
 * survived being revoked elsewhere; `session.svelte.ts` can only cache what
 * signing in handed back. This reconciles it — the same shape as sign-in minus
 * the token.
 *
 * Every field comes from `locals.auth`, resolved from the caller's own
 * credential, so nothing here is more than the caller already has. No other
 * profile, member, session row or token material: returning more is the leak,
 * not the credential it was asked about.
 *
 * It takes no database: the session was already resolved in `hooks.server.ts`,
 * and reading it again would only risk disagreeing with the authority every
 * other endpoint trusts.
 */
export function currentSession(event: AuthEvent): Response {
	const auth = event.locals.auth;
	if (auth === null) return apiError('unauthenticated');
	return json({
		account: auth.account,
		households: auth.households,
		expiresAt: auth.session.expiresAt
	});
}

/** Nothing is left to say once a session is gone, and no body means none to leak. */
function signedOut(): Response {
	return new Response(null, { status: 204 });
}

/**
 * End the session this request presented, and remove the cookie carrying it.
 *
 * The credential comes from `sessionTokenFrom`, the same resolver the request
 * hook uses, so this revokes exactly what the caller sent, not whatever
 * `locals.auth` resolved to. Bearer beats cookie here for the same reason there.
 *
 * Idempotent on purpose: a browser holding a cookie the server has forgotten —
 * expired, revoked elsewhere — must still be able to get rid of it, and a 401
 * would leave it stuck presenting a session that does not exist. No oracle: 204
 * either way, whether or not a row was deleted.
 */
export function signOut(db: DatabaseSync, event: AuthEvent): Response {
	const token = sessionTokenFrom(event.request, event.cookies.get(SESSION_COOKIE));
	if (token !== undefined) endSession(db, token);
	clearSessionCookie(event.cookies, event.url);
	return signedOut();
}

/**
 * End every session the account has — the "sign out my other devices" a lost
 * phone needs, and why sessions are rows rather than signed tokens.
 *
 * This one needs `locals.auth` because it acts on an account, not a credential;
 * an anonymous request names no account to act on. The requesting session goes
 * with the rest: a stolen phone is exactly the case, and leaving the caller
 * signed in would mean doing it twice.
 */
export function signOutEverywhere(db: DatabaseSync, event: AuthEvent): Response {
	const auth = event.locals.auth;
	if (auth === null) return apiError('unauthenticated');
	endAllSessions(db, auth.account.id);
	clearSessionCookie(event.cookies, event.url);
	return signedOut();
}
