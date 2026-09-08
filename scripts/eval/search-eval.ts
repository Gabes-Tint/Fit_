/**
 * How well food search answers what a person meant, measured against the real
 * catalog rather than a fixture.
 *
 * A ranking change is easy to argue about and hard to see: "chicken" gains a
 * better third row and loses a worse fifth one, and nobody can say whether that
 * is progress. This runner answers that with numbers, on the same 1.4 GB file
 * the VM serves, so a change is accepted or rejected on evidence.
 *
 * It is not a gate. It needs a catalog that is not in the repository and not in
 * CI, it takes about a minute, and its verdict is a judgement about food rather
 * than a pass or a fail. Run it by hand, keep the report, compare the next one
 * against it with `--baseline`.
 *
 *   node scripts/eval/search-eval.ts --label baseline
 *   node scripts/eval/search-eval.ts --label byproducts --baseline reports/eval/search-baseline.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { pickDefaultServing, type ServingRow } from '../../src/lib/domain/default-serving.ts';
import { catalogPath } from '../../src/lib/server/catalog/connection.ts';
import { searchTerms, singular } from '../../src/lib/server/catalog/query.ts';
import { searchSql } from '../../src/lib/server/catalog/ranking.ts';
import { prepared } from '../../src/lib/server/catalog/statements.ts';
import {
	availableFoods,
	pageFillFailure,
	pageFillRows,
	pageFillViolations,
	type PageFillMeasurement
} from './page-fill.ts';
import { readJsonFile } from '../security/shared.ts';
import type { SearchFixture, SearchFixtureQuery } from '../quality/config-types';

/** How deep a person is credited with looking. Precision is measured over this many rows. */
const PRECISION_DEPTH = 3;

/** How deep a name that must not appear is looked for. One row past the fold. */
const FORBIDDEN_DEPTH = 5;

/** Warm samples per query. Enough for a p95 over 40 queries without the run taking minutes. */
const WARM_SAMPLES = 5;

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

type EvalQuery = SearchFixtureQuery;

type QueryResult = {
	query: string;
	group: string;
	returned: number;
	precision: number;
	reciprocalRank: number;
	violations: string[];
	top: string[];
	coldMs: number;
	warmMs: number[];
};

type GroupMetrics = {
	queries: number;
	precisionAt3: number;
	mrr: number;
	violations: number;
	thinResults: number;
};

type Report = {
	label: string;
	catalog: string;
	when: string;
	overall: GroupMetrics;
	groups: Record<string, GroupMetrics>;
	latency: { coldP50: number; coldP95: number; warmP50: number; warmP95: number };
	queries: QueryResult[];
	pageFill: PageFillMeasurement[];
};

/** `--label x --baseline y`, with the flags this runner understands and nothing else. */
function options(argv: string[]): { label: string; baseline: string | null } {
	const read = (flag: string): string | null => {
		const at = argv.indexOf(flag);
		return at === -1 ? null : (argv[at + 1] ?? null);
	};
	return { label: read('--label') ?? 'run', baseline: read('--baseline') };
}

/**
 * Names are compared folded, because the catalog is not typed by hand.
 *
 * Case, because it writes "MILK" and "Milk, whole" in the same column. And the
 * no-break space, because some rows carry one where a space belongs — the
 * generic beef row really is "Beef,\u00a0tenderloin steak, raw" — and a fixture
 * that had to reproduce that byte could be neither written nor reviewed.
 */
function fold(name: string): string {
	return name.replaceAll('\u00a0', ' ').trim().toLowerCase();
}

/** The same folding in SQL, so the fixture check compares like with like. */
const FOLDED_NAME = "trim(replace(lower(name), char(160), ' '))";

/** The ranked names for one query, exactly as `searchFoods` would ask for them. */
function ranked(db: DatabaseSync, typed: string, limit: number): string[] {
	const terms = searchTerms(typed);
	if (terms === null) return [];
	const rows = prepared(db, searchSql('f.name')).all({
		match: terms.match,
		text: terms.text,
		singular: singular(terms.text),
		prefix: `${singular(terms.text)}%`,
		limit
	});
	return rows.map((row) => String(row['name']));
}

/**
 * The exact label a food with no household measure fell back to before #157:
 * a bare, unexplained "100 g" a person could mistake for a real serving. A
 * different bare weight (Whopper's own reported "286.0g") is the source's own
 * data and no fallback at all, so only this literal string counts.
 */
const SILENT_100G = '100 g';

/**
 * The serving label the top result of a query would carry, mirroring what
 * `withDefaultServing` (`src/lib/server/catalog/default-serving.ts`) computes
 * server-side: the food's own reported serving when it has one, otherwise its
 * best household measure, otherwise the explicit "per 100 g" fallback.
 *
 * Reimplemented against raw SQL rather than importing that module, because it
 * imports `$lib/domain/catalog-food` — an alias only SvelteKit's tooling
 * resolves, not the plain `node` this runner executes under. `null` when the
 * query returns nothing.
 */
function topServingLabel(db: DatabaseSync, typed: string, limit: number): string | null {
	const terms = searchTerms(typed);
	if (terms === null) return null;
	const rows = prepared(db, searchSql('f.food_id, f.serving_label, f.serving_g')).all({
		match: terms.match,
		text: terms.text,
		singular: singular(terms.text),
		prefix: `${singular(terms.text)}%`,
		limit
	});
	const top = rows[0];
	if (top === undefined) return null;
	const servingG = top['serving_g'];
	if (typeof servingG === 'number') {
		const label = top['serving_label'];
		return typeof label === 'string' ? label : `${servingG} g`;
	}
	const foodId = Number(top['food_id']);
	const servingRows: ServingRow[] = db
		.prepare(
			`select label, grams from food_serving
			where food_id = ? and typeof(label) = 'text' and typeof(grams) in ('real', 'integer')
			order by is_default desc, label`
		)
		.all(foodId)
		.map((row) => ({ label: String(row['label']), grams: Number(row['grams']) }));
	return pickDefaultServing(servingRows)?.label ?? 'per 100 g';
}

/** Milliseconds for one search, discarding the rows. */
function timed(db: DatabaseSync, typed: string, limit: number): number {
	const started = performance.now();
	ranked(db, typed, limit);
	return performance.now() - started;
}

function score(entry: EvalQuery, names: string[]): Omit<QueryResult, 'coldMs' | 'warmMs'> {
	const acceptable = new Set(entry.acceptable.map(fold));
	const forbidden = new Set(entry.forbidden.map(fold));
	const top = names.slice(0, PRECISION_DEPTH);
	const hits = top.filter((name) => acceptable.has(fold(name))).length;
	const first = names.findIndex((name) => acceptable.has(fold(name)));
	return {
		query: entry.query,
		group: entry.group,
		returned: names.length,
		// Divided by what was actually returned, so a query the ranking answers
		// with two rows is not punished twice for the same thin result set. The
		// thinness is reported on its own, as `thinResults`.
		precision: top.length === 0 ? 0 : hits / top.length,
		reciprocalRank: first === -1 ? 0 : 1 / (first + 1),
		violations: names.slice(0, FORBIDDEN_DEPTH).filter((name) => forbidden.has(fold(name))),
		top: names.slice(0, FORBIDDEN_DEPTH)
	};
}

function mean(values: number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const at = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
	return sorted[Math.max(0, at)] ?? 0;
}

function summarize(results: QueryResult[]): GroupMetrics {
	return {
		queries: results.length,
		precisionAt3: mean(results.map((result) => result.precision)),
		mrr: mean(results.map((result) => result.reciprocalRank)),
		violations: results.reduce((total, result) => total + result.violations.length, 0),
		thinResults: results.filter((result) => result.returned < PRECISION_DEPTH).length
	};
}

/**
 * Every name the fixture names, checked against the catalog.
 *
 * A fixture that misspells a name silently lowers precision and looks like a
 * ranking regression, which is the one failure mode that would make every
 * number here untrustworthy. So it is a hard failure, not a warning.
 */
function unknownNames(db: DatabaseSync, queries: EvalQuery[]): string[] {
	const wanted = queries.flatMap((entry) =>
		[...entry.acceptable, ...entry.forbidden].map((name) => ({ entry, name }))
	);
	// `name` carries no index, so this is a table scan of 2.5 million rows. One
	// scan for every name at once, rather than one per name, is the difference
	// between four seconds and an hour.
	const placeholders = wanted.map(() => '?').join(', ');
	const present = new Set(
		db
			.prepare(
				`select distinct ${FOLDED_NAME} as folded from food
				where ${FOLDED_NAME} in (${placeholders})`
			)
			.all(...wanted.map(({ name }) => fold(name)))
			.map((row) => String(row['folded']))
	);
	return wanted
		.filter(({ name }) => !present.has(fold(name)))
		.map(({ entry, name }) => `${entry.query}: ${name}`);
}

/**
 * A cold sample per query, each on its own connection.
 *
 * A fresh connection is as cold as a run without root can be: it clears
 * SQLite's page cache and the prepared statement, but the file's pages stay in
 * the operating system's cache, which only `drop_caches` would clear. So these
 * are process-cold, not machine-cold, and the honest use of them is comparing
 * two variants on one machine rather than predicting the VM's first request.
 */
function coldPass(file: string, fixture: SearchFixture): Map<string, number> {
	const samples = new Map<string, number>();
	for (const entry of fixture.queries) {
		const db = new DatabaseSync(file, { readOnly: true });
		db.exec('pragma query_only = true');
		samples.set(entry.query, timed(db, entry.query, fixture.limit));
		db.close();
	}
	return samples;
}

function table(rows: string[][]): string {
	const widths = rows[0]?.map((_, column) =>
		Math.max(...rows.map((row) => (row[column] ?? '').length))
	);
	return rows
		.map((row) => row.map((cell, column) => cell.padEnd(widths?.[column] ?? 0)).join('  '))
		.join('\n');
}

function metricRows(report: Report, baseline: Report | null): string[][] {
	const groups = ['failing', 'good', 'adversarial'];
	const delta = (now: number, before: number | undefined, digits = 3): string =>
		before === undefined ? '' : `${now - before >= 0 ? '+' : ''}${(now - before).toFixed(digits)}`;
	const row = (name: string, now: GroupMetrics, before: GroupMetrics | undefined): string[] => [
		name,
		String(now.queries),
		now.precisionAt3.toFixed(3),
		delta(now.precisionAt3, before?.precisionAt3),
		now.mrr.toFixed(3),
		delta(now.mrr, before?.mrr),
		String(now.violations),
		delta(now.violations, before?.violations, 0),
		String(now.thinResults)
	];
	return [
		['group', 'n', 'P@3', 'Δ', 'MRR', 'Δ', 'bad@5', 'Δ', 'thin'],
		...groups.map((group) =>
			row(group, report.groups[group] ?? summarize([]), baseline?.groups[group])
		),
		row('overall', report.overall, baseline?.overall)
	];
}

const { label, baseline: baselinePath } = options(process.argv.slice(2));
const file = catalogPath();
const fixture = await readJsonFile<SearchFixture>(
	path.join(projectRoot, 'data', 'eval', 'search-queries.json')
);

const db = new DatabaseSync(file, { readOnly: true });
db.exec('pragma query_only = true');
const missing = unknownNames(db, fixture.queries);
if (missing.length > 0) {
	throw new Error(`the fixture names rows this catalog does not have:\n  ${missing.join('\n  ')}`);
}

const cold = coldPass(file, fixture);
const results: QueryResult[] = fixture.queries.map((entry) => {
	const names = ranked(db, entry.query, fixture.limit);
	const warm = Array.from({ length: WARM_SAMPLES }, () => timed(db, entry.query, fixture.limit));
	return { ...score(entry, names), coldMs: cold.get(entry.query) ?? 0, warmMs: warm };
});
const restaurantDb = new DatabaseSync(file, { readOnly: true });
restaurantDb.exec('pragma query_only = true');
const servingViolations = fixture.queries
	.filter((entry) => entry.group === 'restaurant')
	.map((entry) => ({
		query: entry.query,
		label: topServingLabel(restaurantDb, entry.query, fixture.limit)
	}))
	.filter(({ label: servingLabel }) => servingLabel === null || servingLabel === SILENT_100G);
restaurantDb.close();
if (servingViolations.length > 0) {
	throw new Error(
		`#157: these restaurant queries still answer a silent 100 g serving:\n  ${servingViolations
			.map(({ query, label: servingLabel }) => `${query}: ${servingLabel ?? '(no result)'}`)
			.join('\n  ')}`
	);
}

/**
 * The page-fill pass, at the largest page a caller may ask for.
 *
 * A second precision pass at `limit` 50 was the other candidate and is not
 * worth its runtime: P@3 reads the first three rows, so it returns the same
 * number at 50 as at 10 — which is exactly why it could not see #275. The
 * collapse empties the tail of a page, so the tail is what gets measured.
 */
const pageFill: PageFillMeasurement[] = fixture.pageFill.queries.map((entry) => {
	const terms = searchTerms(entry.query);
	const limit = fixture.pageFill.limit;
	return {
		...entry,
		available: terms === null ? 0 : availableFoods(db, terms.match, limit),
		returned: ranked(db, entry.query, limit).length
	};
});

db.close();

const warmSamples = results.flatMap((result) => result.warmMs);
const coldSamples = results.map((result) => result.coldMs);
const report: Report = {
	label,
	catalog: file,
	when: new Date().toISOString(),
	overall: summarize(results),
	groups: Object.fromEntries(
		['failing', 'good', 'adversarial'].map((group) => [
			group,
			summarize(results.filter((result) => result.group === group))
		])
	),
	latency: {
		coldP50: percentile(coldSamples, 0.5),
		coldP95: percentile(coldSamples, 0.95),
		warmP50: percentile(warmSamples, 0.5),
		warmP95: percentile(warmSamples, 0.95)
	},
	queries: results,
	pageFill
};

const baseline = baselinePath === null ? null : await readJsonFile<Report>(baselinePath);
const outputDirectory = path.join(projectRoot, 'reports', 'eval');
await mkdir(outputDirectory, { recursive: true });
const output = path.join(outputDirectory, `search-${label}.json`);
await writeFile(output, `${JSON.stringify(report, null, '\t')}\n`);

const latency = report.latency;
process.stdout.write(
	`${label} — ${fixture.queries.length} queries against ${file}\n\n` +
		`${table(metricRows(report, baseline))}\n\n` +
		`page fill at limit ${fixture.pageFill.limit}\n\n` +
		`${table(pageFillRows(pageFill))}\n\n` +
		`latency ms: cold p50 ${latency.coldP50.toFixed(1)}, cold p95 ${latency.coldP95.toFixed(1)}, ` +
		`warm p50 ${latency.warmP50.toFixed(1)}, warm p95 ${latency.warmP95.toFixed(1)}\n` +
		`report: ${path.relative(projectRoot, output)}\n`
);

// Last, so the numbers above and the written report are there to read when it
// fires. The other two hard failures come before the run because they make its
// numbers meaningless; this one is a number, and the run is its evidence.
const collapsed = pageFillViolations(pageFill);
if (collapsed.length > 0) {
	throw new Error(pageFillFailure(collapsed, fixture.pageFill.limit));
}
