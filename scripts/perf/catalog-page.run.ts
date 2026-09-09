import { existsSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJsonFile } from '../security/shared.ts';
import type { SearchFixture } from '../quality/config-types';
import { summarizeLatencies } from './server-latency-metrics.ts';

/**
 * `searchFoods` on its own, against the installed catalog: what one search
 * page costs inside the process, with the preview server, the session cookie
 * and the loopback round trip taken out of it.
 *
 * Instrument 3 (`server-latency.ts`) measures the endpoint, which is the
 * number a person waits for, and it is the right instrument for a change that
 * moves tens of milliseconds. It is the wrong one for a change that moves one:
 * measured over four alternating runs on one machine, its warm p50 for the
 * same build wandered between 24 ms and 40 ms, because a freshly spawned
 * server, a fresh account and a fresh set of pages read from disk are not the
 * same two times running. This holds all of that still — one process, one
 * connection, statements already prepared, every query already asked once —
 * so a run's own spread is under a millisecond and two builds can be compared
 * by alternating between them.
 *
 * The trade is that it measures less: no serialization, no HTTP, no auth. A
 * number from here is a claim about the catalog reads, not about the endpoint.
 *
 * Runs under plain `node` through `source-resolver.ts`, the same way instrument
 * 4 reaches these modules, because `foods.ts` imports `$lib` aliases that only
 * SvelteKit's tooling resolves.
 */
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

/** How many times the whole query set is timed. Every pass is a warm pass. */
const PASSES = 10;

/** The page size `/api/foods` serves by default, so the samples match the endpoint's work. */
const PAGE = 20;

interface Catalog {
	searchFoods: (db: DatabaseSync, typed: string, limit: number) => unknown[];
}

async function main(): Promise<void> {
	const { catalogPath } = (await import('../../src/lib/server/catalog/connection.ts')) as {
		catalogPath: () => string;
	};
	const file = catalogPath();
	if (!existsSync(file)) {
		console.log(`No catalog file at ${file} — nothing to measure.`);
		return;
	}

	register('./source-resolver.ts', import.meta.url);
	const foods = (await import(
		pathToFileURL(path.join(projectRoot, 'src/lib/server/catalog/foods.ts')).href
	)) as unknown as Catalog;

	const fixture = await readJsonFile<SearchFixture>(
		path.join(projectRoot, 'data', 'eval', 'search-queries.json')
	);
	const queries = fixture.queries.map((entry) => entry.query);

	const db = new DatabaseSync(file, { readOnly: true });
	// Every statement prepared and every btree and FTS page this query set
	// touches read once, so what follows is warm throughout. The cold pass is
	// instrument 3's business, and it says so.
	for (const query of queries) foods.searchFoods(db, query, PAGE);

	const samples: number[] = [];
	for (let pass = 0; pass < PASSES; pass += 1) {
		for (const query of queries) {
			const started = performance.now();
			foods.searchFoods(db, query, PAGE);
			samples.push(performance.now() - started);
		}
	}
	db.close();

	const summary = summarizeLatencies('searchFoods (warm)', samples);
	const mean = samples.reduce((total, each) => total + each, 0) / samples.length;
	console.log(
		`${summary.endpoint}: ${summary.samples} samples, ` +
			`p50 ${summary.p50Ms.toFixed(2)} ms, p95 ${summary.p95Ms.toFixed(2)} ms, ` +
			`mean ${mean.toFixed(2)} ms`
	);
}

await main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
