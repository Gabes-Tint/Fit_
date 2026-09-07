import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestEvent } from './$types';

const catalog = { name: 'food catalog' } as unknown as DatabaseSync;
const searchCatalog = vi.fn(() => new Response('{}', { status: 200 }));
const getDatabase = vi.fn();

vi.mock('$lib/server/catalog/connection', () => ({ getCatalog: () => catalog }));
vi.mock('$lib/server/catalog/endpoints', () => ({ searchCatalog }));
vi.mock('$lib/server/db', () => ({ getDatabase }));

const { GET } = await import('./+server');

describe('GET /api/foods', () => {
	it('searches the catalog connection, never the application database', () => {
		const event = { url: new URL('https://fit.example/api/foods?q=milk') } as RequestEvent;
		void GET(event);
		expect(searchCatalog).toHaveBeenCalledWith(catalog, event);
		expect(getDatabase).not.toHaveBeenCalled();
	});
});
