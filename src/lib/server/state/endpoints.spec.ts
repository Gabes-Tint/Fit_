import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import { registerAccount } from '../users/accounts';
import type { Account, Auth } from '../users/types';
import { readState, readStateBody, writeState } from './endpoints';
import type { StateEvent } from './endpoints';

/** See the note in `password.spec.ts`: the production cost is too slow to test at. */
const CHEAP = { n: 2 ** 12, r: 8, p: 1 };

const SITE = 'https://fit.example/api/state';

type RequestOptions = {
	body?: unknown;
	rawBody?: string;
	headers?: Record<string, string>;
	contentLength?: number | string;
};

function putRequest(options: RequestOptions = {}): Request {
	const headers = new Headers(options.headers ?? { 'content-type': 'application/json' });
	const body =
		options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
	if (options.contentLength !== undefined) {
		headers.set('content-length', String(options.contentLength));
	}
	const request =
		body === undefined
			? new Request(SITE, { method: 'PUT', headers })
			: new Request(SITE, { method: 'PUT', headers, body });
	// `new Request` supplies `text/plain` for a string body the caller did not
	// label, so omitting the header here has to mean removing it afterwards.
	// Without this, a case meaning "no content type" quietly declared one.
	if (!headers.has('content-type')) request.headers.delete('content-type');
	return request;
}

function eventFor(auth: StateEvent['locals']['auth'], request: Request = putRequest()): StateEvent {
	return { request, locals: { auth } };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

let db: DatabaseSync;
let account: Account;
let householdId: string;

beforeEach(async () => {
	db = openDatabase(':memory:');
	const result = await registerAccount(
		db,
		{
			username: 'jordan',
			displayName: 'Jordan',
			password: 'correct horse battery',
			householdName: 'Flat 3'
		},
		CHEAP
	);
	if (!result.ok) throw new Error(`registration failed: ${JSON.stringify(result.problem)}`);
	account = result.account;
	householdId = db.prepare('select id from household').get()?.['id'] as string;
});

/**
 * Each case opens its own database; close it. Under a mutation run, hundreds of
 * live `node:sqlite` handles crash the worker, which Stryker records as a timeout.
 */
afterEach(() => {
	db.close();
});

function authFor(): Auth {
	return {
		account,
		session: { id: 's1', accountId: account.id, expiresAt: '2027-01-01T00:00:00.000Z' },
		households: [{ householdId, name: 'Flat 3', role: 'owner' }]
	};
}

const throwingDatabase = {
	prepare: () => {
		throw new Error('no database access is allowed for an unauthenticated request');
	}
} as unknown as DatabaseSync;

describe('readState', () => {
	it('answers unauthenticated with no session, touching no database', () => {
		const response = readState(throwingDatabase, eventFor(null));
		expect(response.status).toBe(401);
	});

	it('answers unauthenticated for a session with no household', () => {
		const auth = { ...authFor(), households: [] };
		const response = readState(throwingDatabase, eventFor(auth));
		expect(response.status).toBe(401);
	});

	it('reads version 0 and a null body when nothing is stored', async () => {
		const response = readState(db, eventFor(authFor()));
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({
			version: 0,
			format: 'tend.v1',
			body: null,
			updatedAt: null
		});
	});

	it('reads back a document a write stored, as a parsed object', async () => {
		await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 1 } } }))
		);
		const response = readState(db, eventFor(authFor()));
		const body = await bodyOf(response);
		expect(body['version']).toBe(1);
		expect(body['body']).toEqual({ a: 1 });
	});

	it('cannot read a document belonging to another household', async () => {
		await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 1 } } }))
		);

		const other = await registerAccount(
			db,
			{
				username: 'alex',
				displayName: 'Alex',
				password: 'correct horse battery',
				householdName: 'Other Flat'
			},
			CHEAP
		);
		if (!other.ok) throw new Error('registration failed');
		const otherHouseholdId = db
			.prepare('select id from household where name = ?')
			.get('Other Flat')?.['id'] as string;
		const otherAuth = {
			account: other.account,
			session: { id: 's2', accountId: other.account.id, expiresAt: '2027-01-01T00:00:00.000Z' },
			households: [{ householdId: otherHouseholdId, name: 'Other Flat', role: 'owner' as const }]
		};

		const response = readState(db, eventFor(otherAuth));
		expect(await bodyOf(response)).toEqual({
			version: 0,
			format: 'tend.v1',
			body: null,
			updatedAt: null
		});
	});

	it('finds nothing once the household that owned the document is deleted', async () => {
		await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 1 } } }))
		);
		db.prepare('delete from household where id = ?').run(householdId);
		expect(db.prepare('select count(*) as n from household_state').get()?.['n']).toBe(0);
	});
});

describe('writeState', () => {
	it('answers unauthenticated with no session, touching no database', async () => {
		const response = await writeState(throwingDatabase, eventFor(null));
		expect(response.status).toBe(401);
	});

	it('stores the first write and answers version 1', async () => {
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 1 } } }))
		);
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toMatchObject({ version: 1 });
		expect(db.prepare('select count(*) as n from household_state').get()?.['n']).toBe(1);
	});

	it('stores the body re-serialized, not the sender formatting', async () => {
		await writeState(
			db,
			eventFor(
				authFor(),
				putRequest({ rawBody: '{"version": 0, "format": "tend.v1", "body": {"a":   1}}' })
			)
		);
		expect(db.prepare('select body from household_state').get()?.['body']).toBe(
			JSON.stringify({ a: 1 })
		);
	});

	it('accepts a second write at the version the first returned', async () => {
		await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 1 } } }))
		);
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 1, format: 'tend.v1', body: { a: 2 } } }))
		);
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toMatchObject({ version: 2 });
		expect(db.prepare('select body from household_state').get()?.['body']).toBe(
			JSON.stringify({ a: 2 })
		);
	});

	it('refuses a stale version and leaves the stored row unchanged', async () => {
		await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 1 } } }))
		);
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 2 } } }))
		);
		expect(response.status).toBe(409);
		expect(await bodyOf(response)).toEqual({
			error: { code: 'stale-version' },
			version: 1,
			format: 'tend.v1',
			body: { a: 1 }
		});
		expect(db.prepare('select version from household_state').get()?.['version']).toBe(1);
	});

	it('refuses a stale write before anything is stored, answering the null-document defaults', async () => {
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 1, format: 'tend.v1', body: { a: 1 } } }))
		);
		expect(response.status).toBe(409);
		expect(await bodyOf(response)).toEqual({
			error: { code: 'stale-version' },
			version: 0,
			format: 'tend.v1',
			body: null
		});
		expect(db.prepare('select count(*) as n from household_state').get()?.['n']).toBe(0);
	});

	it('refuses a body over the size limit and stores nothing', async () => {
		const oversized = { version: 0, format: 'tend.v1', body: { a: 'x'.repeat(5 * 1024 * 1024) } };
		const response = await writeState(db, eventFor(authFor(), putRequest({ body: oversized })));
		expect(response.status).toBe(400);
		expect((await bodyOf(response))['error']).toMatchObject({ code: 'invalid-body' });
		expect(db.prepare('select count(*) as n from household_state').get()?.['n']).toBe(0);
	});

	it('refuses a declared content-length over the limit before reading the body', async () => {
		const response = await writeState(
			db,
			eventFor(
				authFor(),
				putRequest({
					body: { version: 0, format: 'tend.v1', body: {} },
					contentLength: 5 * 1024 * 1024
				})
			)
		);
		expect(response.status).toBe(400);
	});

	it('refuses a body that is not a JSON object', async () => {
		const response = await writeState(db, eventFor(authFor(), putRequest({ rawBody: '[]' })));
		expect(response.status).toBe(400);
		expect((await bodyOf(response))['error']).toMatchObject({ code: 'invalid-body' });
	});

	it('refuses a document body that is not a plain object', async () => {
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: [] } }))
		);
		expect(response.status).toBe(400);
		expect((await bodyOf(response))['error']).toMatchObject({ code: 'invalid-body' });
	});

	it('refuses a document body that is a primitive, not an object', async () => {
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: 'nope' } }))
		);
		expect(response.status).toBe(400);
		expect((await bodyOf(response))['error']).toMatchObject({ code: 'invalid-body' });
	});

	it('refuses a null document body', async () => {
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v1', body: null } }))
		);
		expect(response.status).toBe(400);
		expect((await bodyOf(response))['error']).toMatchObject({ code: 'invalid-body' });
	});

	it('refuses a request that does not declare a JSON content type', async () => {
		// The full matrix of content types is `declaredMediaType`'s, tested once in
		// `api.spec.ts`; this is writeState's own refusal shape for the case it names.
		const response = await writeState(
			db,
			eventFor(
				authFor(),
				putRequest({
					body: { version: 0, format: 'tend.v1', body: {} },
					headers: { 'content-type': 'text/plain' }
				})
			)
		);
		expect(response.status).toBe(400);
	});

	it('refuses an unknown format and stores nothing', async () => {
		const response = await writeState(
			db,
			eventFor(authFor(), putRequest({ body: { version: 0, format: 'tend.v2', body: {} } }))
		);
		expect(response.status).toBe(400);
		expect(await bodyOf(response)).toEqual({
			error: { code: 'invalid-input', field: 'format', reason: 'unsupported' }
		});
		expect(db.prepare('select count(*) as n from household_state').get()?.['n']).toBe(0);
	});

	it.each([-1, 1.5, '0', null])(
		'refuses a version that is not a non-negative integer: %s',
		async (version) => {
			const response = await writeState(
				db,
				eventFor(authFor(), putRequest({ body: { version, format: 'tend.v1', body: {} } }))
			);
			expect(response.status).toBe(400);
			expect(await bodyOf(response)).toEqual({
				error: { code: 'invalid-input', field: 'version', reason: 'invalid' }
			});
			expect(db.prepare('select count(*) as n from household_state').get()?.['n']).toBe(0);
		}
	);

	it('accepts a body exactly at the size ceiling and refuses one byte more', async () => {
		// Mirrors the module's own MAX_STATE_BODY_BYTES; kept local because the
		// constant is not exported.
		const MAX_STATE_BODY_BYTES = 4 * 1024 * 1024;
		const prefix = '{"version":0,"format":"tend.v1","body":{"a":"';
		const suffix = '"}}';
		const atCeiling =
			prefix + 'x'.repeat(MAX_STATE_BODY_BYTES - prefix.length - suffix.length) + suffix;
		expect(atCeiling.length).toBe(MAX_STATE_BODY_BYTES);
		const okResponse = await writeState(
			db,
			eventFor(authFor(), putRequest({ rawBody: atCeiling }))
		);
		expect(okResponse.status).toBe(200);

		const overCeiling = atCeiling.slice(0, -3) + 'y' + suffix;
		expect(overCeiling.length).toBe(MAX_STATE_BODY_BYTES + 1);
		const refused = await writeState(db, eventFor(authFor(), putRequest({ rawBody: overCeiling })));
		expect(refused.status).toBe(400);
	});

	it('accepts a declared content-length exactly at the size ceiling', async () => {
		const response = await writeState(
			db,
			eventFor(
				authFor(),
				putRequest({
					body: { version: 0, format: 'tend.v1', body: { a: 1 } },
					contentLength: 4 * 1024 * 1024
				})
			)
		);
		expect(response.status).toBe(200);
	});
});

describe('readStateBody', () => {
	it('reads a valid body into its parts', async () => {
		const result = await readStateBody(
			putRequest({ body: { version: 0, format: 'tend.v1', body: { a: 1 } } })
		);
		expect(result).toEqual({ ok: true, version: 0, format: 'tend.v1', body: { a: 1 } });
	});

	it('refuses a malformed JSON body rather than throwing', async () => {
		const result = await readStateBody(putRequest({ rawBody: '{"version":' }));
		expect(result).toEqual({ ok: false, code: 'invalid-body' });
	});

	it('reports the exact code for an invalid version', async () => {
		const result = await readStateBody(
			putRequest({ body: { version: -1, format: 'tend.v1', body: {} } })
		);
		expect(result).toEqual({
			ok: false,
			code: 'invalid-input',
			field: 'version',
			reason: 'invalid'
		});
	});

	it('reports the exact code for an unsupported format', async () => {
		const result = await readStateBody(
			putRequest({ body: { version: 0, format: 'tend.v2', body: {} } })
		);
		expect(result).toEqual({
			ok: false,
			code: 'invalid-input',
			field: 'format',
			reason: 'unsupported'
		});
	});

	it('reports invalid-body for a request that does not declare a JSON content type', async () => {
		const result = await readStateBody(
			putRequest({ body: { version: 0, format: 'tend.v1', body: {} }, headers: {} })
		);
		expect(result).toEqual({ ok: false, code: 'invalid-body' });
	});

	it('reports invalid-body for a declared content-length over the limit', async () => {
		const result = await readStateBody(
			putRequest({
				body: { version: 0, format: 'tend.v1', body: {} },
				contentLength: 5 * 1024 * 1024
			})
		);
		expect(result).toEqual({ ok: false, code: 'invalid-body' });
	});

	it('reports invalid-body rather than throwing when reading the body fails', async () => {
		const throwingRequest = {
			headers: new Headers({ 'content-type': 'application/json' }),
			text: () => Promise.reject(new Error('stream reset'))
		} as unknown as Request;
		const result = await readStateBody(throwingRequest);
		expect(result).toEqual({ ok: false, code: 'invalid-body' });
	});
});
