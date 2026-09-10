import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureCatalog } from '../../../../tests/catalog-fixture';
import type { Auth } from '../users/types';
import { MAX_QUERIES, MAX_QUERY_LENGTH } from '$lib/domain/resolve-limits';
import { MAX_BODY_BYTES } from '../api';
import { resolveFoodNames, type ResolveEvent } from './resolve-endpoint';

const SIGNED_IN = {
	account: { id: 'a1', username: 'jordan', displayName: 'Jordan', createdAt: '2026-01-01' },
	session: { id: 's1', accountId: 'a1', expiresAt: '2026-02-01' },
	households: [{ householdId: 'h1', name: 'Flat 3', role: 'owner' }]
} satisfies Auth;

type ResolvedItem = {
	query: string;
	food: { name: string } | null;
	alternatives: { name: string }[];
};

/**
 * A fresh event each time: a `Request` body may only be read once, so a shared
 * one would make the second test that used it fail on a stream nothing sent.
 */
function eventFor(
	body: unknown,
	auth: Auth | null = SIGNED_IN,
	headers: Record<string, string> = { 'content-type': 'application/json' }
): ResolveEvent {
	return {
		request: new Request('https://fit.example/api/foods/resolve', {
			method: 'POST',
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		locals: { auth }
	};
}

function asking(...queries: string[]): ResolveEvent {
	return eventFor({ queries });
}

/**
 * A request that declares no length, so the text ceiling is what decides. A real
 * `Request` sets `content-length` from its body, which would refuse an oversized
 * one at the header and leave the second check untested.
 */
function streaming(body: string): ResolveEvent {
	return {
		request: {
			headers: new Headers({ 'content-type': 'application/json' }),
			text: () => Promise.resolve(body)
		} as unknown as Request,
		locals: { auth: SIGNED_IN }
	};
}

/** A body of exactly `length` characters that asks about one name. */
function padded(length: number): string {
	const around = JSON.stringify({ queries: ['milk'], pad: '' });
	return JSON.stringify({ queries: ['milk'], pad: 'x'.repeat(length - around.length) });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

async function itemsOf(response: Response): Promise<ResolvedItem[]> {
	return (await bodyOf(response))['items'] as ResolvedItem[];
}

let catalog: DatabaseSync;

beforeEach(() => {
	catalog = createFixtureCatalog();
});

afterEach(() => {
	catalog.close();
});

describe('resolveFoodNames', () => {
	it('refuses a request with no session, as every other catalog endpoint does', async () => {
		const response = await resolveFoodNames(catalog, asking('milk'));
		expect(response.status).toBe(200);
		const anonymous = await resolveFoodNames(catalog, eventFor({ queries: ['milk'] }, null));
		expect(anonymous.status).toBe(401);
		expect(await bodyOf(anonymous)).toEqual({ error: { code: 'unauthenticated' } });
	});

	it('says the catalog is unavailable when the file is not installed', async () => {
		const response = await resolveFoodNames(null, asking('milk'));
		expect(response.status).toBe(503);
		expect(await bodyOf(response)).toEqual({ error: { code: 'catalog-unavailable' } });
	});

	it('decides authentication before it looks for a catalog', async () => {
		const response = await resolveFoodNames(null, eventFor({ queries: ['milk'] }, null));
		expect(await bodyOf(response)).toEqual({ error: { code: 'unauthenticated' } });
	});

	it('refuses a body the catalog would have answered, when there is no session', async () => {
		// The gate runs before the body is read, so nothing about the request's
		// own shape can change a 401 into anything else.
		const response = await resolveFoodNames(catalog, eventFor('not json at all', null));
		expect(response.status).toBe(401);
	});

	it('answers one row per name, in the order they were asked', async () => {
		const items = await itemsOf(await resolveFoodNames(catalog, asking('milk', 'banana')));
		expect(items.map((item) => item.query)).toEqual(['milk', 'banana']);
	});

	it('puts the catalog’s first-ranked row in `food`', async () => {
		const items = await itemsOf(await resolveFoodNames(catalog, asking('milk')));
		expect(items[0]?.food?.name).toBe('Milk, whole');
	});

	it('offers the two rows behind it as alternatives, and no more', async () => {
		const items = await itemsOf(await resolveFoodNames(catalog, asking('milk')));
		expect(items[0]?.alternatives).toHaveLength(2);
		expect(items[0]?.alternatives.map((food) => food.name)).toEqual(['Milk, dried', 'MILK']);
	});

	describe('a three-row page is nearly always a full one (#337 review)', () => {
		// `resolveFood` asks for three rows, not the ten a search shows, so a
		// page of branded rows is far likelier here than anywhere the ranking
		// was measured. What resolves has to be a row the query matched — the
		// head-noun widening fills a tail, and a full page has no tail.
		it('resolves a branded-only page to the product, not to the head noun’s food', async () => {
			const items = await itemsOf(await resolveFoodNames(catalog, asking('green apple')));
			expect(items[0]?.food?.name).toBe('GREEN APPLE');
			// The fruit is offered behind it rather than instead of it.
			expect(items[0]?.alternatives.map((food) => food.name)).toContain(
				'Apples, granny smith, with skin, raw'
			);
		});

		it('resolves a compound food to the compound, not to its head noun', async () => {
			// Rice for cauliflower rice is 360 kcal answering for 24.
			const items = await itemsOf(await resolveFoodNames(catalog, asking('cauliflower rice')));
			expect(items[0]?.food?.name).toBe('CAULIFLOWER RICE');
		});
	});

	it('answers a name the catalog has nothing for with no food and no alternatives', async () => {
		const items = await itemsOf(await resolveFoodNames(catalog, asking('xyzzy gruel')));
		expect(items).toEqual([{ query: 'xyzzy gruel', food: null, alternatives: [] }]);
	});

	it('resolves every name in one round trip, up to the cap', async () => {
		const many = Array.from({ length: MAX_QUERIES }, () => 'milk');
		const response = await resolveFoodNames(catalog, asking(...many));
		expect(response.status).toBe(200);
		expect(await itemsOf(response)).toHaveLength(MAX_QUERIES);
	});

	it('refuses one name past the cap rather than answering some of them', async () => {
		const tooMany = Array.from({ length: MAX_QUERIES + 1 }, () => 'milk');
		const response = await resolveFoodNames(catalog, asking(...tooMany));
		expect(response.status).toBe(400);
		expect(await bodyOf(response)).toEqual({ error: { code: 'invalid-body' } });
	});

	it('accepts a name of exactly the length it allows', async () => {
		const longest = 'm'.repeat(MAX_QUERY_LENGTH);
		expect((await resolveFoodNames(catalog, asking(longest))).status).toBe(200);
	});

	it('refuses a name one character past that length', async () => {
		const tooLong = 'm'.repeat(MAX_QUERY_LENGTH + 1);
		expect((await resolveFoodNames(catalog, asking(tooLong))).status).toBe(400);
	});

	it('refuses the body when one name of several is too long', async () => {
		// The cap is on every name, not on any name: a sentence is refused whole
		// rather than searched for the short half of it.
		const tooLong = 'm'.repeat(MAX_QUERY_LENGTH + 1);
		expect((await resolveFoodNames(catalog, asking('milk', tooLong))).status).toBe(400);
	});

	it('refuses an empty list rather than spending a round trip on nothing', async () => {
		expect((await resolveFoodNames(catalog, asking())).status).toBe(400);
	});

	it.each([
		['no `queries` field at all', { names: ['milk'] }],
		['a `queries` field that is not a list', { queries: 'milk' }],
		['a list holding something that is not a name', { queries: ['milk', 7] }],
		// An array answers a number to `.length`, so a caps check alone would pass
		// it and hand a non-string to the catalog query.
		['a list holding an array that answers a length', { queries: ['milk', ['ab']] }],
		['a list holding null', { queries: [null] }],
		['a body that is not an object', ['milk']],
		['a body that is JSON null', null]
	])('refuses %s', async (_case, body) => {
		const response = await resolveFoodNames(catalog, eventFor(body));
		expect(response.status).toBe(400);
		expect(await bodyOf(response)).toEqual({ error: { code: 'invalid-body' } });
	});

	it('refuses text that is not JSON at all', async () => {
		expect((await resolveFoodNames(catalog, eventFor('{'))).status).toBe(400);
	});

	it('refuses a body that does not declare JSON', async () => {
		// The full matrix of content types is `declaredMediaType`'s, tested once in
		// `api.spec.ts`; this is resolveFoodNames's own refusal shape for the case
		// it names.
		const response = await resolveFoodNames(
			catalog,
			eventFor({ queries: ['milk'] }, SIGNED_IN, { 'content-type': 'text/plain' })
		);
		expect(response.status).toBe(400);
	});

	it('refuses a body whose declared length is past the ceiling, before reading it', async () => {
		const response = await resolveFoodNames(
			catalog,
			eventFor({ queries: ['milk'] }, SIGNED_IN, {
				'content-type': 'application/json',
				'content-length': '99999'
			})
		);
		expect(response.status).toBe(400);
	});

	it('accepts a body declared at exactly the ceiling', async () => {
		const response = await resolveFoodNames(
			catalog,
			eventFor({ queries: ['milk'] }, SIGNED_IN, {
				'content-type': 'application/json',
				'content-length': String(MAX_BODY_BYTES)
			})
		);
		expect(response.status).toBe(200);
	});

	it('refuses text past the ceiling even when nothing declared a length', async () => {
		// The header is only what the sender says; the text is what arrived.
		expect((await resolveFoodNames(catalog, streaming(padded(MAX_BODY_BYTES + 1)))).status).toBe(
			400
		);
	});

	it('accepts text of exactly the ceiling', async () => {
		expect((await resolveFoodNames(catalog, streaming(padded(MAX_BODY_BYTES)))).status).toBe(200);
	});

	it('refuses a body whose stream cannot be read', async () => {
		const broken: ResolveEvent = {
			request: {
				headers: new Headers({ 'content-type': 'application/json' }),
				text: () => Promise.reject(new Error('socket closed'))
			} as unknown as Request,
			locals: { auth: SIGNED_IN }
		};
		expect((await resolveFoodNames(catalog, broken)).status).toBe(400);
	});
});
