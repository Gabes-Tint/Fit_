import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestEvent } from './$types';

const catalog = { name: 'food catalog' } as unknown as DatabaseSync;
const lookupBarcode = vi.fn(() => new Response('{}', { status: 200 }));
const getDatabase = vi.fn();

vi.mock('$lib/server/catalog/connection', () => ({ getCatalog: () => catalog }));
vi.mock('$lib/server/catalog/endpoints', () => ({ lookupBarcode }));
vi.mock('$lib/server/db', () => ({ getDatabase }));

const { GET } = await import('./+server');

describe('GET /api/foods/barcode', () => {
	it('looks the code up on the catalog connection, never the application database', () => {
		const url = new URL('https://fit.example/api/foods/barcode?code=00000000005487');
		const event = { url } as RequestEvent;
		void GET(event);
		expect(lookupBarcode).toHaveBeenCalledWith(catalog, event);
		expect(getDatabase).not.toHaveBeenCalled();
	});
});
