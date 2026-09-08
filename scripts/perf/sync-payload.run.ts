import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { formatCommitted } from './prettier-format.ts';
import { formatSyncPayload, payloadRows } from './sync-payload.ts';
import type { SyncPayloadReport } from './sync-payload.ts';

/**
 * `bun run perf:sync-payload`: the state-document sync lead from issue #130.
 * Writes `reports/perf/sync-payload.{json,md}`, and with `--baseline` records
 * the same table as `quality/perf-sync-payload.md`, the committed number a
 * later run is compared against.
 *
 * Under `bun`, not `node` like `perf:measure`: this builds its documents out
 * of `src/lib/domain`, whose modules import each other without file
 * extensions, and plain Node does not resolve those. It costs no build, no
 * browser and no catalog, so it stays its own command rather than adding a
 * fifth instrument to `perf:measure` — which would also mean re-recording
 * that command's whole baseline, browser numbers and all, for a table it
 * measures none of.
 */
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportDirectory = path.join(projectRoot, 'reports', 'perf');
const committedPath = path.join(projectRoot, 'quality', 'perf-sync-payload.md');

async function main(): Promise<void> {
	const baseline = process.argv.slice(2).includes('--baseline');
	const report: SyncPayloadReport = { when: new Date().toISOString(), rows: payloadRows() };
	const markdown = formatSyncPayload(report.rows);

	await mkdir(reportDirectory, { recursive: true });
	await writeFile(
		path.join(reportDirectory, 'sync-payload.json'),
		`${JSON.stringify(report, null, 2)}\n`
	);
	await writeFile(path.join(reportDirectory, 'sync-payload.md'), markdown);

	if (baseline) {
		await writeFile(committedPath, await formatCommitted(markdown, committedPath));
		console.log(`Wrote ${path.relative(projectRoot, committedPath)}.`);
	}

	console.log(markdown);
}

await main();
