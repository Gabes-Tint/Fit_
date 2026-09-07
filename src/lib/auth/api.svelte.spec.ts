import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$lib/testing/fixtures';
import {
	currentSession,
	register,
	retryAfterSeconds,
	signIn,
	signOut,
	signOutEverywhere
} from './api';

type Call = {
	path: string;
	method: string | undefined;
	contentType: string | undefined;
	body: Record<string, string> | null;
};

function pathOf(input: string | URL | Request): string {
	if (typeof input === 'string') return input;
	return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function bodyOf(body: BodyInit | null | undefined): Record<string, string> | null {
	return typeof body === 'string' ? (JSON.parse(body) as Record<string, string>) : null;
}

function contentTypeOf(headers: HeadersInit | undefined): string | undefined {
	return headers === undefined
		? undefined
		: (new Headers(headers).get('content-type') ?? undefined);
}

// `fetch` is stubbed: these own the shape of the request and the reading of the answer, not the endpoint.
function stub(response: Response | Error): Call[] {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
		calls.push({
			path: pathOf(input),
			method: init?.method,
			contentType: contentTypeOf(init?.headers),
			body: bodyOf(init?.body)
		});
		return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
	});
	return calls;
}

const SESSION = {
	account: { id: 'a-1', username: 'robin', displayName: 'Robin', createdAt: '2026-08-01' },
	households: [{ householdId: 'h-1', name: 'Home', role: 'owner' }],
	expiresAt: '2026-11-27T00:00:00.000Z'
};

const CREDENTIALS = { username: 'robin', password: 'a-long-password' };

const REGISTRATION = {
	username: 'robin',
	displayName: 'Robin',
	password: 'a-long-password',
	householdName: 'Home'
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('signIn', () => {
	it('posts to the sessions endpoint', async () => {
		const calls = stub(jsonResponse(SESSION));
		await signIn(CREDENTIALS);
		expect(calls[0]?.path).toBe('/api/sessions');
	});

	it('posts, because signing in creates a session rather than reading one', async () => {
		const calls = stub(jsonResponse(SESSION));
		await signIn(CREDENTIALS);
		expect(calls[0]?.method).toBe('POST');
	});

	it('declares JSON, which is the only body the endpoint accepts', async () => {
		const calls = stub(jsonResponse(SESSION));
		await signIn(CREDENTIALS);
		expect(calls[0]?.contentType).toBe('application/json');
	});

	it('sends the credentials as text fields', async () => {
		const calls = stub(jsonResponse(SESSION));
		await signIn(CREDENTIALS);
		expect(calls[0]?.body).toEqual(CREDENTIALS);
	});

	it('returns the session the endpoint answered with', async () => {
		stub(jsonResponse(SESSION));
		const result = await signIn(CREDENTIALS);
		expect(result).toEqual({ ok: true, value: SESSION });
	});

	it('reports a rejected password as invalid credentials', async () => {
		stub(jsonResponse({ error: { code: 'invalid-credentials' } }, { status: 401 }));
		const result = await signIn(CREDENTIALS);
		expect(result).toEqual({ ok: false, failure: { code: 'invalid-credentials' } });
	});

	it('carries Retry-After back with a throttled attempt', async () => {
		stub(
			jsonResponse(
				{ error: { code: 'too-many-attempts' } },
				{ status: 429, headers: { 'retry-after': '45' } }
			)
		);
		const result = await signIn(CREDENTIALS);
		expect(result).toMatchObject({ failure: { code: 'too-many-attempts', retryAfterSeconds: 45 } });
	});

	it('carries the field and reason of a rejected input', async () => {
		stub(
			jsonResponse(
				{ error: { code: 'invalid-input', field: 'username', reason: 'too-long' } },
				{ status: 400 }
			)
		);
		const result = await signIn(CREDENTIALS);
		expect(result).toMatchObject({ failure: { field: 'username', reason: 'too-long' } });
	});

	it('reads a failure body with no error in it as a malformed one', async () => {
		// A 400 from a proxy or WAF is JSON without the `error` object this server sends.
		stub(jsonResponse({}, { status: 400 }));
		const result = await signIn(CREDENTIALS);
		expect(result).toMatchObject({ ok: false, failure: { code: 'invalid-body' } });
	});

	it('reads a failure body whose error is not an object as a malformed one', async () => {
		stub(jsonResponse({ error: 'nope' }, { status: 400 }));
		const result = await signIn(CREDENTIALS);
		expect(result).toMatchObject({ ok: false, failure: { code: 'invalid-body' } });
	});

	it('reads a failure body whose error is null as a malformed one, rather than throwing', async () => {
		// `typeof null` is 'object', so the null check is what keeps a JSON `null` from throwing.
		stub(jsonResponse({ error: null }, { status: 400 }));
		await expect(signIn(CREDENTIALS)).resolves.toMatchObject({
			ok: false,
			failure: { code: 'invalid-body' }
		});
	});

	it('refuses an empty code, which names no failure', async () => {
		// Codes match by exact string; `''` is not one, so an empty code is a malformed body.
		stub(jsonResponse({ error: { code: '' } }, { status: 400 }));
		const result = await signIn(CREDENTIALS);
		expect(result).toMatchObject({ failure: { code: 'invalid-body' } });
	});

	it('ignores a field and reason that are not text, rather than showing a number', async () => {
		stub(jsonResponse({ error: { code: 'invalid-input', field: 7, reason: 9 } }, { status: 400 }));
		const result = await signIn(CREDENTIALS);
		expect(result).toEqual({
			ok: false,
			failure: {
				code: 'invalid-input',
				field: undefined,
				reason: undefined,
				retryAfterSeconds: undefined
			}
		});
	});

	it('passes a refused origin through as its own code', async () => {
		stub(jsonResponse({ error: { code: 'forbidden-origin' } }, { status: 403 }));
		const result = await signIn(CREDENTIALS);
		expect(result).toMatchObject({ ok: false, failure: { code: 'forbidden-origin' } });
	});

	it('refuses a 200 whose body is not a session object', async () => {
		// A captive portal answers 200 with non-session JSON; believing it signs in against nothing.
		stub(jsonResponse(5));
		const result = await signIn(CREDENTIALS);
		expect(result).toEqual({ ok: false, failure: { code: 'unreachable' } });
	});

	it('calls a dropped connection unreachable rather than a rejection', async () => {
		stub(new TypeError('Failed to fetch'));
		const result = await signIn(CREDENTIALS);
		expect(result).toEqual({ ok: false, failure: { code: 'unreachable' } });
	});

	it('refuses to invent a code for a failure body it does not recognize', async () => {
		stub(jsonResponse({ error: { code: 'teapot' } }, { status: 400 }));
		const result = await signIn(CREDENTIALS);
		expect(result).toMatchObject({ failure: { code: 'invalid-body' } });
	});
});

describe('register', () => {
	it('posts to the accounts endpoint', async () => {
		const calls = stub(jsonResponse(SESSION, { status: 201 }));
		await register(REGISTRATION);
		expect(calls[0]?.path).toBe('/api/accounts');
	});

	it('posts, because registering creates an account', async () => {
		const calls = stub(jsonResponse(SESSION, { status: 201 }));
		await register(REGISTRATION);
		expect(calls[0]?.method).toBe('POST');
	});

	it('sends the fields the form collected, and only those', async () => {
		const calls = stub(jsonResponse(SESSION, { status: 201 }));
		await register(REGISTRATION);
		expect(calls[0]?.body).toEqual(REGISTRATION);
	});

	it('treats the 201 as a success', async () => {
		stub(jsonResponse(SESSION, { status: 201 }));
		const result = await register(REGISTRATION);
		expect(result).toEqual({ ok: true, value: SESSION });
	});

	it('reports a taken username', async () => {
		stub(jsonResponse({ error: { code: 'username-taken', field: 'username' } }, { status: 409 }));
		const result = await register(REGISTRATION);
		expect(result).toMatchObject({ failure: { code: 'username-taken', field: 'username' } });
	});

	it('calls a dropped connection unreachable rather than a created account', async () => {
		// The one failure where the request may still have landed: the caller must
		// tell "no account" from "no answer", because retrying the second can
		// collide with an account that now exists.
		stub(new TypeError('Failed to fetch'));
		await expect(register(REGISTRATION)).resolves.toEqual({
			ok: false,
			failure: { code: 'unreachable' }
		});
	});
});

describe('signOut', () => {
	it('deletes the current session', async () => {
		const calls = stub(new Response(null, { status: 204 }));
		await signOut();
		expect(calls[0]).toMatchObject({ path: '/api/sessions/current', method: 'DELETE' });
	});

	it('sends no body, so no content type is declared', async () => {
		const calls = stub(new Response(null, { status: 204 }));
		await signOut();
		expect(calls[0]?.body).toBeNull();
	});

	it('calls a dropped connection unreachable rather than a completed sign-out', async () => {
		stub(new TypeError('Failed to fetch'));
		await expect(signOut()).resolves.toEqual({ ok: false, failure: { code: 'unreachable' } });
	});

	it('succeeds on the empty 204', async () => {
		stub(new Response(null, { status: 204 }));
		await expect(signOut()).resolves.toEqual({ ok: true, value: null });
	});
});

describe('signOutEverywhere', () => {
	it('deletes the whole collection', async () => {
		const calls = stub(new Response(null, { status: 204 }));
		await signOutEverywhere();
		expect(calls[0]).toMatchObject({ path: '/api/sessions', method: 'DELETE' });
	});

	it('reports the refusal when nothing was signed in', async () => {
		stub(jsonResponse({ error: { code: 'unauthenticated' } }, { status: 401 }));
		const result = await signOutEverywhere();
		expect(result).toMatchObject({ ok: false, failure: { code: 'unauthenticated' } });
	});
});

describe('currentSession', () => {
	it('reads the current session rather than changing anything', async () => {
		const calls = stub(jsonResponse(SESSION));
		await currentSession();
		expect(calls[0]).toMatchObject({ path: '/api/sessions/current', method: 'GET' });
	});

	it('sends no body, so no content type is declared', async () => {
		const calls = stub(jsonResponse(SESSION));
		await currentSession();
		expect(calls[0]?.body).toBeNull();
		expect(calls[0]?.contentType).toBeUndefined();
	});

	it('hands back the session the server answered with', async () => {
		stub(jsonResponse(SESSION));
		await expect(currentSession()).resolves.toEqual({ ok: true, value: SESSION });
	});

	it('reports a refused read as signed out, which is a definitive answer', async () => {
		stub(jsonResponse({ error: { code: 'unauthenticated' } }, { status: 401 }));
		const result = await currentSession();
		expect(result).toMatchObject({ ok: false, failure: { code: 'unauthenticated' } });
	});

	it('reads a refusal with no body at all as a malformed one, rather than throwing', async () => {
		// A proxy in front of the app can answer 401 with no body; the caller still needs a failure.
		stub(new Response(null, { status: 401 }));
		await expect(currentSession()).resolves.toEqual({
			ok: false,
			failure: {
				code: 'invalid-body',
				field: undefined,
				reason: undefined,
				retryAfterSeconds: undefined
			}
		});
	});

	it('reports a request that never arrived as unreachable, which is not', async () => {
		stub(new TypeError('Failed to fetch'));
		const result = await currentSession();
		expect(result).toMatchObject({ ok: false, failure: { code: 'unreachable' } });
	});

	it('reports a body that is not a session as unreachable rather than as a session', async () => {
		stub(new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }));
		expect(await currentSession()).toMatchObject({ ok: false, failure: { code: 'unreachable' } });
	});
});

describe('retryAfterSeconds', () => {
	it('reads whole seconds', () => {
		expect(retryAfterSeconds(new Headers({ 'retry-after': '90' }))).toBe(90);
	});

	it('has nothing to say when the header is absent', () => {
		expect(retryAfterSeconds(new Headers())).toBeUndefined();
	});

	it('refuses a zero, which would tell someone to wait for nothing', () => {
		expect(retryAfterSeconds(new Headers({ 'retry-after': '0' }))).toBeUndefined();
	});

	it('refuses an HTTP-date, which this endpoint never sends', () => {
		expect(
			retryAfterSeconds(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }))
		).toBeUndefined();
	});
});
