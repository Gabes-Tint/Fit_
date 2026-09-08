import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { formatPlans, planStatements } from './sql-plans.ts';
import { formatCommitted } from './prettier-format.ts';

/**
 * `check:perf-plans`: re-runs instrument 4 and diffs it against the committed
 * `quality/perf-plans.md`, so a change that turns an index seek into a scan
 * fails a check instead of waiting to be noticed in a slow request.
 *
 * `--write` records the fresh run as the committed baseline, which is how the
 * plans file is refreshed without also re-running instruments 1 to 3 and
 * overwriting their numbers with this machine's.
 *
 * Wired into the static gate tier (`scripts/quality/gates.ts`): it uses the
 * catalog file when one is installed, or falls back to the fixture schema
 * (which does not reflect production row counts) otherwise, and either way
 * only reads prepared statements and runs `EXPLAIN QUERY PLAN` — no build or
 * migration is required, so it stays fast enough for that tier.
 */
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const committedPath = path.join(projectRoot, 'quality', 'perf-plans.md');

/**
 * `formatPlans` opens its report with a sentence naming where the catalog
 * statements ran — live catalog file or in-memory fixture — so a human
 * reading `quality/perf-plans.md` knows what it was captured against. That
 * sentence is provenance about *this machine*, not part of the contract the
 * gate enforces: the fixture and the live catalog share the same tables and
 * indexes, so a plan is either identical either way or it is real drift, and
 * real drift always shows up inside a statement's own `Plan:` block. Left in
 * the comparison, the sentence would fail the gate on a pristine tree for
 * anyone whose machine has the catalog installed, purely because CI (which
 * never has it) committed the fixture wording. So it is excluded from the
 * diff here and left untouched in the file for humans.
 */
function stripProvenance(content: string): string {
	return content.replace(/^Catalog statements run against the .*$/m, '<provenance omitted>');
}

async function main(): Promise<void> {
	const write = process.argv.slice(2).includes('--write');
	const committed = await readFile(committedPath, 'utf8').catch(() => null);
	if (committed === null && !write) {
		console.error(`No committed plans at ${path.relative(projectRoot, committedPath)}.`);
		console.error('Run `bun run perf:measure -- --baseline` (via node) to create one.');
		process.exitCode = 1;
		return;
	}
	const fresh = await formatCommitted(
		formatPlans(await planStatements(projectRoot)),
		committedPath
	);
	if (write) {
		await writeFile(committedPath, fresh);
		console.log(`Wrote ${path.relative(projectRoot, committedPath)}.`);
		return;
	}
	if (committed !== null && stripProvenance(fresh) === stripProvenance(committed)) {
		console.log('SQLite plans match the committed baseline.');
		return;
	}
	console.error('SQLite plans differ from the committed baseline.');
	console.error(`Committed: ${path.relative(projectRoot, committedPath)}`);
	console.error('Re-run `perf:measure --baseline` and review the diff before committing it.');
	process.exitCode = 1;
}

await main();
