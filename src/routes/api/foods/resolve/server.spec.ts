import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestEvent } from './$types';

const catalog = { name: 'food catalog' } as unknown as DatabaseSync;
const resolveFoodNames = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
const getDatabase = vi.fn();

vi.mock('$lib/server/catalog/connection', () => ({ getCatalog: () => catalog }));
vi.mock('$lib/server/catalog/resolve-endpoint', () => ({ resolveFoodNames }));
vi.mock('$lib/server/db', () => ({ getDatabase }));

const { POST } = await import('./+server');

describe('POST /api/foods/resolve', () => {
	it('resolves against the catalog connection, never the application database', async () => {
		const event = {
			request: new Request('https://fit.example/api/foods/resolve', { method: 'POST' })
		} as RequestEvent;
		await POST(event);
		expect(resolveFoodNames).toHaveBeenCalledWith(catalog, event);
		expect(getDatabase).not.toHaveBeenCalled();
	});
});
