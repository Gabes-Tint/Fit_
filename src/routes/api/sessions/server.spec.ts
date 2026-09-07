import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestEvent } from './$types';

const database = { name: 'application database' } as unknown as DatabaseSync;
const signIn = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
const signOutEverywhere = vi.fn(() => new Response(null, { status: 204 }));

vi.mock('$lib/server/db', () => ({ getDatabase: () => database }));
vi.mock('$lib/server/auth-endpoints', () => ({ signIn, signOutEverywhere }));

const { DELETE, POST } = await import('./+server');

const event = { url: new URL('https://fit.example/api/sessions') } as RequestEvent;

describe('/api/sessions', () => {
	it('signs in on POST through the process-wide database', async () => {
		await POST(event);
		expect(signIn).toHaveBeenCalledWith(database, event);
	});

	it('signs out everywhere on DELETE, rather than ending this session alone', async () => {
		await DELETE(event);
		expect(signOutEverywhere).toHaveBeenCalledWith(database, event);
	});
});
