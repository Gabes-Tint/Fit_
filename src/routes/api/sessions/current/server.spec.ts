import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestEvent } from './$types';

const database = { name: 'application database' } as unknown as DatabaseSync;
const signOut = vi.fn(() => new Response(null, { status: 204 }));
const currentSession = vi.fn(() => new Response('{}', { status: 200 }));

vi.mock('$lib/server/db', () => ({ getDatabase: () => database }));
vi.mock('$lib/server/auth-endpoints', () => ({ currentSession, signOut }));

const { DELETE, GET } = await import('./+server');

describe('GET /api/sessions/current', () => {
	it('reads the session the request presented, opening no database of its own', async () => {
		const event = { url: new URL('https://fit.example/api/sessions/current') } as RequestEvent;
		await GET(event);
		expect(currentSession).toHaveBeenCalledWith(event);
	});
});

describe('DELETE /api/sessions/current', () => {
	it('ends only the session this request presented', async () => {
		const event = { url: new URL('https://fit.example/api/sessions/current') } as RequestEvent;
		await DELETE(event);
		expect(signOut).toHaveBeenCalledWith(database, event);
	});
});
