import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { env } from 'node:process';
import { test as base } from '@playwright/test';
import { previewDatabasePathForPort, previewPortForSlot } from './e2e-workspace';
import { clearRegistrationThrottle } from './e2e-support';

/**
 * A preview server, and the database behind it, for one Playwright worker.
 *
 * Playwright's own `webServer` starts exactly one server for the whole run, so
 * every worker registered accounts against one SQLite file and one
 * registration-throttle bucket. `workers: 1` was the containment for that. A
 * server per worker removes the sharing, so the suite is bounded by cores
 * instead.
 *
 * The build is not here: `globalSetup` runs it once for the whole run, and
 * every worker serves the same output.
 */

export interface PreviewServer {
	/** What the browser should ask for. */
	baseURL: string;
	/** The database only this worker's server writes to. */
	databasePath: string;
}

/** ZAP reaches the app from a container, so that run binds every interface and uses one worker. */
const zapProxied = env.ZAP_PROXY_URL !== undefined;
const READY_TIMEOUT_MS = 120_000;

function removeDatabase(databasePath: string): void {
	for (const suffix of ['', '-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true });
}

async function waitUntilServing(port: number, server: ChildProcess, log: () => string) {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (server.exitCode !== null) {
			throw new Error(`Preview server on port ${port} exited ${server.exitCode}.\n${log()}`);
		}
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`);
			if (response.ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Preview server on port ${port} was not serving in time.\n${log()}`);
}

/** SIGTERM the whole group: `bun run preview` is a parent of the vite process that holds the port. */
function stop(server: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (server.exitCode !== null || server.pid === undefined) {
			resolve();
			return;
		}
		server.once('exit', () => resolve());
		try {
			process.kill(-server.pid, 'SIGTERM');
		} catch {
			server.kill('SIGTERM');
		}
	});
}

async function startPreviewServer(slot: number): Promise<[PreviewServer, () => Promise<void>]> {
	const port = previewPortForSlot(slot);
	const databasePath = previewDatabasePathForPort(port);
	// Every run starts from nothing, so a previous run's accounts and throttle
	// counters cannot decide this one.
	removeDatabase(databasePath);

	const server = spawn(
		'bun',
		[
			'run',
			'preview',
			'--host',
			zapProxied ? '0.0.0.0' : '127.0.0.1',
			'--port',
			String(port),
			'--strictPort'
		],
		{
			// The component-harness route stays closed in production
			// (`hooks.server.ts`); the E2E servers are the only callers that
			// open it, and only against their own preview instance.
			env: { ...env, FIT_DB_PATH: databasePath, FIT_COMPONENT_HARNESS: 'yes' },
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	let output = '';
	const collect = (chunk: Buffer) => {
		output += chunk.toString();
	};
	server.stdout?.on('data', collect);
	server.stderr?.on('data', collect);

	try {
		await waitUntilServing(port, server, () => output);
	} catch (error) {
		await stop(server);
		throw error;
	}

	return [
		{ baseURL: env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`, databasePath },
		async () => {
			await stop(server);
			removeDatabase(databasePath);
		}
	];
}

export const test = base.extend<{ registrationBudget: void }, { previewServer: PreviewServer }>({
	previewServer: [
		async ({}, use, workerInfo) => {
			// An external base URL names one server, so only one worker can mean it.
			if (env.E2E_BASE_URL !== undefined && workerInfo.parallelIndex !== 0) {
				throw new Error('E2E_BASE_URL names a single server; run that suite with one worker.');
			}
			const [server, dispose] = await startPreviewServer(workerInfo.parallelIndex);
			await use(server);
			await dispose();
		},
		{ scope: 'worker' }
	],
	baseURL: async ({ previewServer }, use) => {
		await use(previewServer.baseURL);
	},
	/**
	 * The suite makes more registrations per worker than the hourly allowance,
	 * so each test starts its worker's own counter from zero. Nothing outside
	 * this worker's database is touched.
	 */
	registrationBudget: [
		async ({ previewServer }, use) => {
			clearRegistrationThrottle(previewServer.databasePath);
			await use();
		},
		{ auto: true }
	]
});
