import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVALIDATE } from '../../src/lib/server/cache-policy';
import type * as Config from './config';
import type * as Shared from '../security/shared';

/**
 * The smoke check driven end to end against a stand-in for the deployed app,
 * because the failure that matters is not visible in any one of its pieces:
 * every check passed in isolation while a run that failed part way through
 * left its throwaway account behind in the production `account` table.
 *
 * So the HTTP side is a real server answering the real requests, and the
 * machine is a stub for `remote()` that records the removal script the check
 * would have run. What is asserted is the row: whatever the run decides, the
 * account it registered has to be asked for again.
 */

/** Where `writeReport` is allowed to write during a test. */
const reportRoot = await vi.hoisted(async () => {
	const fs = await import('node:fs');
	const nodeOs = await import('node:os');
	const nodePath = await import('node:path');
	return fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'fit-smoke-report-'));
});

const machine = vi.hoisted(() => ({
	/** What `readlink -f /opt/fit/current` answers with. */
	liveRelease: 'commit-under-test',
	/** What the removal program printed, as `removedAccounts` parses it. */
	removalOutput: '{"accounts":1,"households":1}',
	/** Every username a removal was asked for, in order. */
	removals: [] as string[]
}));

const SMOKE_USERNAME = /smoke\.[0-9]+\.[0-9a-f]{6}/;

/** The version the stand-in application reports, which the deploy compares against. */
const BUILT_VERSION = 'v0.0.7';
let servedVersion = BUILT_VERSION;

vi.mock('./config', async (importOriginal) => ({
	...(await importOriginal<typeof Config>()),
	remote: (script: string): Promise<string> => {
		if (script.startsWith('readlink'))
			return Promise.resolve(`/opt/fit/releases/${machine.liveRelease}\n`);
		const username = SMOKE_USERNAME.exec(script)?.[0];
		if (username === undefined) throw new Error(`unexpected remote script: ${script}`);
		machine.removals.push(username);
		return Promise.resolve(machine.removalOutput);
	}
}));

vi.mock('../security/shared', async (importOriginal) => ({
	...(await importOriginal<typeof Shared>()),
	projectRoot: reportRoot
}));

const { smoke } = await import('./smoke');

/** The one page and the four endpoints the check exercises, and nothing else. */
function application(): { server: Server; accounts: Set<string> } {
	const accounts = new Set<string>();
	const sessions = new Map<string, string>();
	const send = (
		response: ServerResponse,
		status: number,
		body?: unknown,
		cookie?: string
	): void => {
		const headers: Record<string, string | string[]> = { 'content-type': 'application/json' };
		if (cookie !== undefined) headers['set-cookie'] = [`fit_session=${cookie}; Path=/; HttpOnly`];
		response.writeHead(status, headers);
		response.end(body === undefined ? '' : JSON.stringify(body));
	};
	const bodyOf = async (request: IncomingMessage): Promise<Record<string, string>> => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		const raw = Buffer.concat(chunks).toString('utf8');
		return raw === '' ? {} : (JSON.parse(raw) as Record<string, string>);
	};
	const token = (request: IncomingMessage): string | undefined =>
		/fit_session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
	const server = createServer((request, response) => {
		void (async () => {
			const url = (request.url ?? '').split('?')[0];
			const method = request.method ?? 'GET';
			if (method === 'GET' && (url === '/' || url === '/signin')) {
				response.writeHead(200, { 'content-type': 'text/html', 'cache-control': REVALIDATE });
				response.end('<script type="module" src="/_app/immutable/entry/start.js"></script>');
				return;
			}
			if (method === 'POST' && url === '/api/accounts') {
				const body = await bodyOf(request);
				accounts.add(body['username'] ?? '');
				sessions.set('registered', body['username'] ?? '');
				send(response, 201, { account: { username: body['username'] } }, 'registered');
				return;
			}
			if (method === 'POST' && url === '/api/sessions') {
				const body = await bodyOf(request);
				sessions.set('signed-in', body['username'] ?? '');
				send(response, 200, { account: { username: body['username'] } }, 'signed-in');
				return;
			}
			if (method === 'DELETE' && url === '/api/sessions/current') {
				sessions.delete(token(request) ?? '');
				send(response, 204);
				return;
			}
			if (method === 'DELETE' && url === '/api/sessions') {
				sessions.clear();
				send(response, 204);
				return;
			}
			if (method === 'GET' && url === '/api/version') {
				send(response, 200, { version: servedVersion, commit: 'be031ca' });
				return;
			}
			if (method === 'GET' && url === '/api/sessions/current') {
				const username = sessions.get(token(request) ?? '');
				if (username === undefined) {
					send(response, 401, { error: { code: 'unauthenticated' } });
					return;
				}
				send(response, 200, { account: { username } });
				return;
			}
			send(response, 404, { error: { code: 'not_found' } });
		})();
	});
	return { server, accounts };
}

let server: Server;
let accounts: Set<string>;
let base: string;

beforeEach(async () => {
	machine.liveRelease = 'commit-under-test';
	machine.removalOutput = '{"accounts":1,"households":1}';
	machine.removals = [];
	servedVersion = BUILT_VERSION;
	({ server, accounts } = application());
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('no port');
	base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error === undefined ? resolve() : reject(error)))
	);
});

afterAll(async () => {
	await rm(reportRoot, { recursive: true, force: true });
});

async function report(): Promise<{ ok: boolean; failure?: string }> {
	const raw = await readFile(path.join(reportRoot, 'reports', 'deploy', 'smoke.json'), 'utf8');
	return JSON.parse(raw) as { ok: boolean; failure?: string };
}

async function run(): Promise<boolean> {
	return smoke([
		'--base',
		base,
		'--origin',
		base,
		'--commit',
		'commit-under-test',
		'--version',
		BUILT_VERSION
	]);
}

describe('the build the deploy started', () => {
	it('has to be the one answering, not merely the one on the symlink', async () => {
		// The symlink is right and the process is serving something else: a unit
		// that failed to restart, or an edge still handing out the old shell.
		// `readlink` cannot see that, so the application is asked directly.
		servedVersion = 'v0.0.6+be031ca';
		expect(await run()).toBe(false);
		expect((await report()).failure).toContain('the served version is the one this deploy built');
	});

	it('passes when the served version is the string the build baked in', async () => {
		expect(await run()).toBe(true);
		expect((await report()).failure).toBeUndefined();
	});

	it('fails when the endpoint is not there at all, rather than reading a missing version as a match', async () => {
		servedVersion = '';
		expect(await run()).toBe(false);
		expect((await report()).failure).toContain('expected v0.0.7');
	});
});

describe('the account the smoke check registers', () => {
	it('is removed again when every check passes', async () => {
		expect(await run()).toBe(true);
		expect(machine.removals).toEqual([...accounts]);
	});

	it('is removed again when a later check fails part way through the run', async () => {
		// The release check runs after registration and before the removal, and
		// it is the one an operator sees fail: a deploy whose symlink did not
		// move. Before this, that failure walked past the removal entirely and
		// the row stayed in production until somebody counted the accounts.
		machine.liveRelease = 'a-release-that-is-not-this-commit';
		expect(await run()).toBe(false);
		expect(accounts.size).toBe(1);
		expect(machine.removals).toEqual([...accounts]);
	});

	it('reports the check that failed, not the cleanup that followed it', async () => {
		machine.liveRelease = 'a-release-that-is-not-this-commit';
		await run();
		expect((await report()).failure).toContain('the live release is this commit');
	});

	it('is removed again when the served build is not the one this deploy made', async () => {
		servedVersion = 'v0.0.6+be031ca';
		expect(await run()).toBe(false);
		expect(machine.removals).toEqual([...accounts]);
	});

	it('says so when the machine could not take the row back out', async () => {
		machine.removalOutput = 'runuser: command not found';
		expect(await run()).toBe(false);
		expect((await report()).failure).toContain('deleted -1 account row');
	});
});
