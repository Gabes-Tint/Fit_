import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { summarizeLatencies } from './server-latency-metrics.ts';
import type { EndpointLatency } from './server-latency-metrics.ts';
import { readJsonFile } from '../security/shared';
import type { SearchFixture } from '../quality/config-types';

/**
 * Instrument 3: `GET /api/foods?q=` for every query `search:eval` uses, twice
 * each, and one `GET /api/foods/barcode`, all against a signed-in session on
 * a real preview server this script boots and tears down itself. Needs the
 * catalog those endpoints read; `serverLatency` reports `null` with why when
 * this machine does not have one, rather than measuring the
 * `catalog-unavailable` error path and calling that a latency number.
 *
 * The first pass and the rest are reported separately, not pooled, because
 * they answer different questions. `getCatalog()` opens the catalog file on
 * this server's first request to touch it, and every query's first execution
 * reads btree and FTS pages this fresh process has never paged in — measured
 * on this machine at 2.4 s to 8.5 s a query, against 40-450 ms once the same
 * page is read again. #130's own instrument (`phone-paint.run.ts`, before this
 * change) took that one cold sample as "the round trip" and reported multiple
 * seconds; pooling it into 88 pooled samples here is the same mistake spread
 * thinner; it is why the original p95 (247 ms) sat so far above the p50
 * (51 ms). A pass on an already-open connection is what a production server
 * gives every request after its first, so `(warm)` is the number worth
 * comparing across runs; `(cold)` exists to keep that fact visible rather
 * than folded away, the same distinction `scripts/eval/search-eval.ts`
 * already draws between its own cold and warm passes.
 */

const PORT = 4599;
const READY_TIMEOUT_MS = 60_000;
const PASSES = 2;

async function waitUntilServing(port: number, server: ChildProcess): Promise<void> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (server.exitCode !== null) throw new Error(`Preview server on port ${port} exited early.`);
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`);
			if (response.ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Preview server on port ${port} was not serving in time.`);
}

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

/** The `Set-Cookie` value a session-creating response carries, stripped of its attributes. */
function sessionCookieFrom(response: Response): string {
	const header = response.headers.get('set-cookie');
	if (header === null) throw new Error('Response carried no Set-Cookie header.');
	const pair = header.split(';')[0];
	if (pair === undefined) throw new Error('Set-Cookie header was empty.');
	return pair;
}

/** Registers a throwaway account and returns the cookie header later requests authenticate with. */
async function signIn(baseURL: string): Promise<string> {
	const response = await fetch(`${baseURL}/api/accounts`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: baseURL },
		body: JSON.stringify({
			username: `perf-${randomUUID().slice(0, 13)}`,
			displayName: 'Perf',
			password: 'salt-and-pepper-mill',
			householdName: 'Perf'
		})
	});
	if (response.status !== 201) {
		throw new Error(`Registration failed with status ${response.status}.`);
	}
	return sessionCookieFrom(response);
}

/** One request's wall time, discarding the body. */
async function timed(baseURL: string, path: string, cookie: string): Promise<number> {
	const started = performance.now();
	const response = await fetch(`${baseURL}${path}`, { headers: { cookie } });
	await response.json();
	if (!response.ok) throw new Error(`${path} answered ${response.status}.`);
	return performance.now() - started;
}

/** A GTIN-14 this catalog actually carries, found by searching until one turns up. */
async function findKnownBarcode(
	baseURL: string,
	cookie: string,
	queries: string[]
): Promise<string> {
	for (const query of queries) {
		const response = await fetch(`${baseURL}/api/foods?q=${encodeURIComponent(query)}`, {
			headers: { cookie }
		});
		const body = (await response.json()) as { foods: { barcode: string | null }[] };
		const found = body.foods.find((food) => food.barcode !== null);
		if (found?.barcode) return found.barcode;
	}
	throw new Error('No search query returned a food carrying a barcode.');
}

export interface ServerLatencyResult {
	rows: EndpointLatency[] | null;
	skipReason: string | null;
}

/** `null` with why, on a machine with no catalog installed; the measured rows, otherwise. */
export async function measureServerLatency(
	root: string,
	catalogPath: () => string,
	catalogExists: (path: string) => boolean = existsSync
): Promise<ServerLatencyResult> {
	if (!catalogExists(catalogPath())) {
		return {
			rows: null,
			skipReason: `no catalog file at ${catalogPath()} — /api/foods and /api/foods/barcode need one`
		};
	}

	const fixture = await readJsonFile<SearchFixture>(
		path.join(root, 'data', 'eval', 'search-queries.json')
	);
	const queries = fixture.queries.map((entry) => entry.query);

	const runtimeDirectory = await mkdtemp(path.join(tmpdir(), 'fit-perf-server-'));
	const databasePath = path.join(runtimeDirectory, 'app.sqlite');
	const server = spawn(
		'bun',
		['run', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
		{
			cwd: root,
			env: { ...process.env, FIT_DB_PATH: databasePath },
			detached: true,
			stdio: 'ignore'
		}
	);
	try {
		await waitUntilServing(PORT, server);
		const baseURL = `http://127.0.0.1:${PORT}`;
		const cookie = await signIn(baseURL);

		const searchPasses: number[][] = [];
		for (let pass = 0; pass < PASSES; pass += 1) {
			const passSamples: number[] = [];
			for (const query of queries) {
				passSamples.push(await timed(baseURL, `/api/foods?q=${encodeURIComponent(query)}`, cookie));
			}
			searchPasses.push(passSamples);
		}

		const barcode = await findKnownBarcode(baseURL, cookie, queries);
		const barcodePasses: number[][] = [];
		for (let pass = 0; pass < PASSES; pass += 1) {
			barcodePasses.push([
				await timed(baseURL, `/api/foods/barcode?code=${encodeURIComponent(barcode)}`, cookie)
			]);
		}

		return {
			rows: [
				summarizeLatencies('GET /api/foods (cold)', searchPasses[0] ?? []),
				summarizeLatencies('GET /api/foods (warm)', searchPasses.slice(1).flat()),
				summarizeLatencies('GET /api/foods/barcode (cold)', barcodePasses[0] ?? []),
				summarizeLatencies('GET /api/foods/barcode (warm)', barcodePasses.slice(1).flat())
			],
			skipReason: null
		};
	} finally {
		await stop(server);
		await rm(runtimeDirectory, { recursive: true, force: true });
	}
}
