import { describe, expect, it } from 'vitest';
import { apiError, declaredMediaType, MAX_BODY_BYTES, readJsonText, readTextBody } from './api';

const SITE = 'https://fit.example/api/sessions';

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
	return new Request(SITE, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body
	});
}

async function errorBody(response: Response): Promise<unknown> {
	return (await response.json()) as unknown;
}

describe('apiError', () => {
	it.each([
		['invalid-body', 400],
		['invalid-input', 400],
		['invalid-credentials', 401],
		['unauthenticated', 401],
		['forbidden-origin', 403],
		['username-taken', 409],
		['stale-version', 409],
		['too-many-attempts', 429]
	] as const)('answers %s with status %i', async (code, status) => {
		const response = apiError(code);
		expect(response.status).toBe(status);
		expect(await errorBody(response)).toEqual({ error: { code } });
	});

	it('carries back which field the caller got wrong, and why', async () => {
		const response = apiError('invalid-input', { field: 'password', reason: 'too-short' });
		expect(await errorBody(response)).toEqual({
			error: { code: 'invalid-input', field: 'password', reason: 'too-short' }
		});
	});

	it('sets the headers a code needs, such as Retry-After', () => {
		expect(
			apiError('too-many-attempts', {}, { 'retry-after': '120' }).headers.get('retry-after')
		).toBe('120');
	});

	it('answers as JSON, so a client never has to sniff the body', () => {
		expect(apiError('invalid-body').headers.get('content-type')).toContain('application/json');
	});
});

/**
 * `max` is a count of bytes, and `String.length` counts UTF-16 code units. The
 * two agree only for ASCII, so every fixture here carries a character that is
 * one code unit and two UTF-8 bytes: an ASCII body cannot tell a code-unit
 * check from a byte one, and a test it passes against both proves nothing
 * (#283).
 */
const ACCENTED_NAME = 'café';

/** `max` code units, `max + 1` bytes: under the ceiling by the old measure, over it by the real one. */
function straddlingBody(max: number): string {
	return ACCENTED_NAME + 'a'.repeat(max - ACCENTED_NAME.length);
}

/** `max - 1` code units, exactly `max` bytes: the largest body the ceiling still admits. */
function bodyAtCeiling(max: number): string {
	return ACCENTED_NAME + 'a'.repeat(max - ACCENTED_NAME.length - 1);
}

describe('readJsonText', () => {
	it('refuses a non-ASCII body over the ceiling in bytes though under it in code units', async () => {
		const body = straddlingBody(MAX_BODY_BYTES);
		expect(body.length).toBe(MAX_BODY_BYTES);
		expect(Buffer.byteLength(body)).toBe(MAX_BODY_BYTES + 1);
		expect(await readJsonText(jsonRequest(body), MAX_BODY_BYTES)).toBeNull();
	});

	it('accepts a non-ASCII body whose bytes land exactly on the ceiling', async () => {
		const body = bodyAtCeiling(MAX_BODY_BYTES);
		expect(body.length).toBe(MAX_BODY_BYTES - 1);
		expect(Buffer.byteLength(body)).toBe(MAX_BODY_BYTES);
		expect(await readJsonText(jsonRequest(body), MAX_BODY_BYTES)).toBe(body);
	});

	it('hands back the text it read when it is within the ceiling', async () => {
		expect(await readJsonText(jsonRequest('{"food":"café"}'), MAX_BODY_BYTES)).toBe(
			'{"food":"café"}'
		);
	});
});

/**
 * The one matrix of content-type parsing, shared by every endpoint that reads
 * a JSON body: `readTextBody` here and `readStateBody`, `readResolveBody` and
 * `readPhotoBody` elsewhere all route through `declaredMediaType`, so each of
 * their own spec files needs only a test for its own refusal shape, not this
 * matrix again.
 */
describe('declaredMediaType', () => {
	it.each([
		['a bare JSON type', 'application/json', 'application/json'],
		['a JSON type with a charset parameter', 'application/json; charset=utf-8', 'application/json'],
		[
			'a JSON type padded and cased differently',
			'APPLICATION/JSON ; charset=UTF-8',
			'application/json'
		],
		['a non-JSON type', 'text/plain', 'text/plain'],
		[
			'a form-encoded type, what a cross-site form can produce',
			'application/x-www-form-urlencoded',
			'application/x-www-form-urlencoded'
		]
	])('reads %s as %s', (_case, header, expected) => {
		const request = new Request(SITE, { headers: { 'content-type': header } });
		expect(declaredMediaType(request)).toBe(expected);
	});

	it('reads a request with no content-type header as declaring no media type', () => {
		const request = new Request(SITE);
		request.headers.delete('content-type');
		expect(declaredMediaType(request)).toBeNull();
	});
});

describe('readTextBody', () => {
	it('reads the text fields of a JSON object', async () => {
		expect(await readTextBody(jsonRequest('{"username":"jordan","password":"secret"}'))).toEqual({
			username: 'jordan',
			password: 'secret'
		});
	});

	it('refuses a body that does not declare JSON, whatever it contains', async () => {
		// The full matrix of content types is `declaredMediaType`'s, tested once
		// above; this is readTextBody's own refusal shape for the case it names.
		const request = new Request(SITE, {
			method: 'POST',
			headers: { 'content-type': 'text/plain' },
			body: '{"username":"jordan"}'
		});
		expect(await readTextBody(request)).toBeNull();
	});

	it('refuses a body that declares more bytes than four short strings need', async () => {
		const request = jsonRequest('{"username":"jordan"}', {
			'content-length': String(MAX_BODY_BYTES + 1)
		});
		expect(await readTextBody(request)).toBeNull();
	});

	it('accepts a body that declares exactly the ceiling', async () => {
		const padded = JSON.stringify({ username: 'j'.repeat(MAX_BODY_BYTES - 20) });
		const request = jsonRequest(padded, { 'content-length': String(MAX_BODY_BYTES) });
		expect(await readTextBody(request)).not.toBeNull();
	});

	it('refuses a malformed body rather than throwing at the caller', async () => {
		expect(await readTextBody(jsonRequest('{"username":'))).toBeNull();
	});

	it.each(['[]', '"jordan"', '42', 'null', 'true'])(
		'refuses a JSON value that is not an object: %s',
		async (body) => {
			expect(await readTextBody(jsonRequest(body))).toBeNull();
		}
	);

	it.each([
		'{"username":5}',
		'{"username":null}',
		'{"username":{"toString":"jordan"}}',
		'{"username":["jordan"]}',
		'{"username":true}'
	])('refuses a field that is not text rather than coercing it: %s', async (body) => {
		expect(await readTextBody(jsonRequest(body))).toBeNull();
	});

	it('keeps a __proto__ field as an ordinary value instead of a prototype', async () => {
		const fields = await readTextBody(jsonRequest('{"__proto__":"polluted","username":"jordan"}'));
		expect(fields?.['__proto__']).toBe('polluted');
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
	});

	it('reads an empty object as no fields rather than as a malformed body', async () => {
		expect(await readTextBody(jsonRequest('{}'))).toEqual({});
	});
});
