import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Auth } from '../users/types';
import { lookupBarcode, searchCatalog } from './endpoints';
import type { CatalogEvent } from './endpoints';
import { createFixtureCatalog } from '../../../../tests/catalog-fixture';

const SIGNED_IN = {
	account: { id: 'a1', username: 'jordan', displayName: 'Jordan', createdAt: '2026-01-01' },
	session: { id: 's1', accountId: 'a1', expiresAt: '2026-02-01' },
	households: [{ householdId: 'h1', name: 'Flat 3', role: 'owner' }]
} satisfies Auth;

function eventFor(query: string, auth: Auth | null = SIGNED_IN): CatalogEvent {
	return { url: new URL(`https://fit.example/api/foods?${query}`), locals: { auth } };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

let db: DatabaseSync;

beforeEach(() => {
	db = createFixtureCatalog();
});

afterEach(() => {
	db.close();
});

describe('searchCatalog', () => {
	it('refuses a request with no session, as every other endpoint does', async () => {
		const response = searchCatalog(db, eventFor('q=milk', null));
		expect(response.status).toBe(401);
		expect(await bodyOf(response)).toEqual({ error: { code: 'unauthenticated' } });
	});

	it('answers the ranked foods with the query it ran', async () => {
		const body = await bodyOf(searchCatalog(db, eventFor('q=milk&limit=2')));
		expect(body['query']).toBe('milk');
		expect((body['foods'] as { name: string }[]).map((food) => food.name)).toEqual([
			'Milk, whole',
			'Milk, dried'
		]);
	});

	it('treats a missing query as an empty one rather than an error', async () => {
		const response = searchCatalog(db, eventFor(''));
		expect(response.status).toBe(200);
		expect(await bodyOf(response)).toEqual({ query: '', foods: [] });
	});

	it('says the catalog is unavailable when the file is not installed', async () => {
		const response = searchCatalog(null, eventFor('q=milk'));
		expect(response.status).toBe(503);
		expect(await bodyOf(response)).toEqual({ error: { code: 'catalog-unavailable' } });
	});

	it('decides authentication before it looks for a catalog', async () => {
		const response = searchCatalog(null, eventFor('q=milk', null));
		expect(await bodyOf(response)).toEqual({ error: { code: 'unauthenticated' } });
	});
});

describe('lookupBarcode', () => {
	it('refuses a request with no session', () => {
		expect(lookupBarcode(db, eventFor('code=00000000000035', null)).status).toBe(401);
	});

	it('says the catalog is unavailable when the file is not installed', () => {
		expect(lookupBarcode(null, eventFor('code=00000000000035')).status).toBe(503);
	});

	it('answers a known barcode with the one food that carries it', async () => {
		const response = lookupBarcode(db, eventFor('code=00000000000035'));
		expect(response.status).toBe(200);
		const body = await bodyOf(response);
		expect(body['barcode']).toBe('00000000000035');
		expect(body['ambiguous']).toBe(false);
		expect((body['foods'] as { name: string }[]).map((food) => food.name)).toEqual(['MILK']);
	});

	it('hands back every food on a duplicated barcode instead of choosing one', async () => {
		const body = await bodyOf(lookupBarcode(db, eventFor('code=00000000000103')));
		expect(body['ambiguous']).toBe(true);
		expect((body['foods'] as { name: string }[]).map((food) => food.name)).toEqual([
			'GRANOLA BAR, CHOCOLATE',
			'GRANOLA BAR, PEANUT'
		]);
	});

	it('normalizes a scanned UPC to the GTIN-14 the catalog stores', async () => {
		const body = await bodyOf(lookupBarcode(db, eventFor('code=000000000035')));
		expect(body['barcode']).toBe('00000000000035');
	});

	it('gives a clear no-match for a barcode nothing carries', async () => {
		const response = lookupBarcode(db, eventFor('code=00000000009999'));
		expect(response.status).toBe(404);
		expect(await bodyOf(response)).toEqual({
			error: { code: 'not-found', field: 'code', reason: 'unknown' }
		});
	});

	it('separates a barcode it does not know from text that is not a barcode', async () => {
		const response = lookupBarcode(db, eventFor('code=milk'));
		expect(response.status).toBe(400);
		expect(await bodyOf(response)).toEqual({
			error: { code: 'invalid-input', field: 'code', reason: 'invalid' }
		});
	});

	it('treats a missing code as invalid input', () => {
		expect(lookupBarcode(db, eventFor('')).status).toBe(400);
	});
});
