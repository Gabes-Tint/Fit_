import { json } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import {
	apiError,
	declaredMediaType,
	JSON_CONTENT_TYPE,
	readJsonText,
	staleVersion,
	withinDeclaredLength
} from '../api';
import { isStateFormat, SCHEMA_VERSION, stateFormat } from '../../domain/state-document';
import type { Auth, Membership } from '../users/types';
import { readDocument, writeDocument } from './document';

/**
 * The format this build would write, which is only ever used to label a
 * household that has nothing stored yet.
 */
const STATE_FORMAT = stateFormat(SCHEMA_VERSION);

/**
 * The document is the household's entire store, not a handful of text fields;
 * `readTextBody` in `api.ts` caps at 4 KB for that reason and does not fit here.
 */
const MAX_STATE_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The part of SvelteKit's `RequestEvent` these handlers use — see `AuthEvent`
 * in `auth-endpoints.ts` for why it is kept narrow.
 */
export type StateEvent = {
	request: Request;
	locals: App.Locals;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type ParsedStateBody =
	| { ok: true; version: number; format: string; body: Record<string, unknown> }
	| { ok: false; code: 'invalid-body' }
	| { ok: false; code: 'invalid-input'; field: string; reason: string };

/**
 * The body as a JSON object, or `null` for a stream that failed, a body past
 * the ceiling, or text that is not a JSON object. The three share one answer
 * because the caller reports one `invalid-body` for all of them; splitting the
 * read from the parse only produced an intermediate no caller could observe.
 */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
	const raw = await readJsonText(request, MAX_STATE_BODY_BYTES);
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isPlainObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * A version is a non-negative integer. `Number.isInteger` is already false for
 * every value that is not a number, so it carries the type check too and a
 * separate `typeof` guard would decide nothing; the assertion tells the
 * compiler only what that call has just established.
 */
function isValidVersion(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * The PUT payload: a JSON object carrying the household's whole document, up
 * to 4 MB. Checked twice against that ceiling — the declared `content-length`
 * before anything is read, and the text actually received — because the header
 * is only what the sender claims.
 */
export async function readStateBody(request: Request): Promise<ParsedStateBody> {
	if (
		declaredMediaType(request) !== JSON_CONTENT_TYPE ||
		!withinDeclaredLength(request, MAX_STATE_BODY_BYTES)
	) {
		return { ok: false, code: 'invalid-body' };
	}
	const parsed = await readJsonObject(request);
	if (parsed === null || !isPlainObject(parsed['body'])) {
		return { ok: false, code: 'invalid-body' };
	}
	const version = parsed['version'];
	if (!isValidVersion(version)) {
		return { ok: false, code: 'invalid-input', field: 'version', reason: 'invalid' };
	}
	const format = parsed['format'];
	// Well formed, not equal to this build's. The document is stored opaquely and
	// never read here, so a schema this server has never heard of costs it
	// nothing — while refusing one would lock a phone running a newer build out
	// of its own account, and lock it out precisely when it has data no older
	// build can reproduce. Deciding which copy may be used belongs to the client,
	// which is the only party that reads the body; see `state-document.ts`.
	if (!isStateFormat(format)) {
		return { ok: false, code: 'invalid-input', field: 'format', reason: 'unsupported' };
	}
	return { ok: true, version, format, body: parsed['body'] };
}

/** The signed-in account and its first household, or `null` for no session. */
function requireHousehold(event: StateEvent): { auth: Auth; household: Membership } | null {
	const auth = event.locals.auth;
	const household = auth?.households[0];
	if (!auth || !household) return null;
	return { auth, household };
}

/**
 * The household's document, or the empty shape nothing-stored reads as. `body`
 * is parsed here, once, so every caller gets the object it originally sent
 * rather than the JSON text it was stored as.
 */
export function readState(db: DatabaseSync, event: StateEvent): Response {
	const context = requireHousehold(event);
	if (context === null) return apiError('unauthenticated');
	const document = readDocument(db, context.household.householdId);
	if (document === null) {
		return json({ version: 0, format: STATE_FORMAT, body: null, updatedAt: null });
	}
	return json({
		version: document.version,
		format: document.format,
		body: JSON.parse(document.body) as unknown,
		updatedAt: document.updatedAt
	});
}

/**
 * Store the household's document, or refuse it. A version mismatch is not the
 * caller's fault the way a malformed body is: it means another writer went
 * first, so the answer carries what is actually stored rather than just a code.
 *
 * The body is re-serialized before it is stored, so what is on disk is exactly
 * `JSON.stringify` of what was sent, never the sender's original formatting.
 */
export async function writeState(db: DatabaseSync, event: StateEvent): Promise<Response> {
	const context = requireHousehold(event);
	if (context === null) return apiError('unauthenticated');
	const parsed = await readStateBody(event.request);
	if (!parsed.ok) {
		return parsed.code === 'invalid-body'
			? apiError('invalid-body')
			: apiError('invalid-input', { field: parsed.field, reason: parsed.reason });
	}
	const result = writeDocument(db, context.household.householdId, {
		accountId: context.auth.account.id,
		expectedVersion: parsed.version,
		format: parsed.format,
		body: JSON.stringify(parsed.body)
	});
	if (result.ok) return json({ version: result.version, updatedAt: result.updatedAt });
	const current = result.current;
	return staleVersion({
		version: current?.version ?? 0,
		format: current?.format ?? STATE_FORMAT,
		body: current ? (JSON.parse(current.body) as unknown) : null
	});
}
