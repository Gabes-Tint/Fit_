import { json } from '@sveltejs/kit';

/**
 * `field` and `reason` name what the caller got wrong about its own input, and
 * nothing about what the server holds. The code, not a sentence, is what
 * clients match on. The status is derived from the code, so two endpoints
 * cannot answer the same failure with different numbers.
 */
const STATUS = {
	/** The body was not a JSON object of text fields, or was too large to be one. */
	'invalid-body': 400,
	/** A field was present and unusable; `field` and `reason` say which and why. */
	'invalid-input': 400,
	/** Sign-in failed. Deliberately the same answer for an unknown name and a wrong password. */
	'invalid-credentials': 401,
	/** The request carried no session, and this endpoint needs one. */
	unauthenticated: 401,
	/** The origin policy refused a state-changing request. */
	'forbidden-origin': 403,
	/** The catalog has no row for what was asked, such as a barcode nothing carries. */
	'not-found': 404,
	/** Registration only: the username is already in use. */
	'username-taken': 409,
	/** A write's expected version does not match what is stored; the current document is returned alongside it. */
	'stale-version': 409,
	/** The sign-in throttle is holding this attempt; `Retry-After` says for how long. */
	'too-many-attempts': 429,
	/**
	 * The food catalog is not installed on this server. It is a 365 MB file
	 * shipped outside the release, so a deployment without it still serves
	 * every other route and the client falls back to its bundled foods.
	 */
	'catalog-unavailable': 503,
	/**
	 * Reading a photo is not possible right now: no vision key is configured,
	 * or the model refused, timed out or failed. One code for all of them
	 * deliberately — the caller can do nothing differently about any of them,
	 * and the upstream's own status is a fact about our account, not theirs.
	 */
	'photo-unavailable': 503
} as const;

export type ApiErrorCode = keyof typeof STATUS;

/** What the caller got wrong about its own input. Never anything about stored state. */
export type ApiErrorDetail = { field?: string; reason?: string };

export function apiError(
	code: ApiErrorCode,
	detail: ApiErrorDetail = {},
	headers: Record<string, string> = {}
): Response {
	return json({ error: { code, ...detail } }, { status: STATUS[code], headers });
}

/**
 * A write whose expected version does not match what is stored. The current
 * document is returned alongside the code — unlike `apiError`'s detail, this
 * is a fact about stored state, not about what the caller got wrong — but the
 * status still comes out of the same table, so a stale-version answer can
 * never drift from the code that names it.
 */
export function staleVersion(current: {
	version: number;
	format: string;
	body: unknown;
}): Response {
	return json(
		{ error: { code: 'stale-version' }, ...current },
		{ status: STATUS['stale-version'] }
	);
}

/**
 * `Retry-After` is whole seconds and never zero: a client told to wait must
 * have something to wait for, and rounding up keeps it from returning early
 * only to be refused again.
 */
export function retryAfter(retryAfterMs: number): Record<string, string> {
	const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
	return { 'retry-after': String(seconds) };
}

/**
 * Refused before parsing: four short strings need far less than
 * `adapter-node`'s `BODY_SIZE_LIMIT`, which is sized for uploads.
 */
export const MAX_BODY_BYTES = 4096;

export const JSON_CONTENT_TYPE = 'application/json';

/**
 * The media type before any parameter, lower-cased. `null` when the request
 * declares none at all.
 */
export function declaredMediaType(request: Request): string | null {
	const header = request.headers.get('content-type');
	if (header === null) return null;
	const separator = header.indexOf(';');
	const type = separator === -1 ? header : header.slice(0, separator);
	return type.trim().toLowerCase();
}

/**
 * Whether the declared `content-length` is within `max`. A request that
 * declares no length at all passes here — the header is only what the sender
 * claims, so a caller that needs the real ceiling enforced checks the text it
 * actually reads too.
 */
export function withinDeclaredLength(request: Request, max: number): boolean {
	return !(Number(request.headers.get('content-length')) > max);
}

/**
 * The body text, read once, or `null` for a stream that failed to read or
 * text past `max` bytes. Parsing is left to the caller: what counts as a
 * malformed or wrongly-shaped body differs by endpoint.
 */
export async function readJsonText(request: Request, max: number): Promise<string | null> {
	let raw: string;
	try {
		raw = await request.text();
	} catch {
		// A stream that broke is the sender's problem, not an error to throw here.
		return null;
	}
	return raw.length > max ? null : raw;
}

/**
 * Every value is text; anything else is malformed, not something to coerce. No
 * coercion is what stops `{"username": {"toString": ...}}` from reaching a query
 * as some other shape.
 */
function textFieldsOf(parsed: unknown): Record<string, string> | null {
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	// Null-prototype, so a `__proto__` key is an ordinary field, not a prototype
	// assignment.
	const fields = Object.create(null) as Record<string, string>;
	for (const name of Object.keys(record)) {
		const value = record[name];
		if (typeof value !== 'string') return null;
		fields[name] = value;
	}
	return fields;
}

/**
 * The body as text fields, or `null` for anything that is not one. The content
 * type is required, not sniffed: a body that does not declare JSON is not JSON.
 * Requiring it also keeps these endpoints outside the content types a
 * cross-site form can produce.
 */
export async function readTextBody(request: Request): Promise<Record<string, string> | null> {
	if (declaredMediaType(request) !== JSON_CONTENT_TYPE) return null;
	if (!withinDeclaredLength(request, MAX_BODY_BYTES)) return null;
	const raw = await readJsonText(request, MAX_BODY_BYTES);
	if (raw === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// A malformed body is the sender's error, not an error to throw here.
		return null;
	}
	return textFieldsOf(parsed);
}
