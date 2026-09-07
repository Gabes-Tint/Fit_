import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestEvent } from './$types';

const database = { name: 'application database' } as unknown as DatabaseSync;
const catalog = { name: 'food catalog' } as unknown as DatabaseSync;
const readMealPhoto = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));

vi.mock('$lib/server/db', () => ({ getDatabase: () => database }));
vi.mock('$lib/server/catalog/connection', () => ({ getCatalog: () => catalog }));
vi.mock('$lib/server/photo/endpoints', () => ({ readMealPhoto }));

const { POST } = await import('./+server');

describe('POST /api/meals/photo', () => {
	it('reads the plate against the application database and the food catalog', async () => {
		const event = { url: new URL('https://fit.example/api/meals/photo') } as RequestEvent;
		await POST(event);
		expect(readMealPhoto).toHaveBeenCalledWith(database, catalog, event);
	});
});
