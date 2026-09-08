/**
 * Whether a common query still answers with a full page of distinct foods.
 *
 * `DEDUP_DEPTH` in `src/lib/server/catalog/ranking.ts` exists for one failure —
 * issue #106, where hundreds of branded rows sharing a name filled the depth,
 * collapsed to one, and "pasta" answered with a single food. The gate named as
 * the proof that a change to it is safe was `search:eval` P@3, and #275
 * measured that P@3 holds at 0.670 all the way down to depth 200, where
 * "ice cream" answers with one row. Precision over the first three rows cannot
 * see a collapse that empties the rest of the page.
 *
 * So this measures the property directly: a broad query must come back with as
 * many distinct foods as the catalog actually has for it, up to the largest
 * page `/api/foods` will serve.
 *
 * The expectation is read out of the catalog on every run rather than written
 * into the fixture. Pinning "ice cream returns 50" would fail the next time the
 * ETL rebuilds the catalog with a different food count, which is a worse
 * fixture than none. Asking the catalog how many distinct foods it holds for
 * the query and requiring the search to return that many is a statement about
 * the ranking, not about a row count, so it survives a rebuild and still fails
 * the moment the collapse starts losing foods.
 */
import type { DatabaseSync } from 'node:sqlite';
import { singular } from '../../src/lib/server/catalog/query.ts';

/** One broad query, what a person typing it is owed, and how the run answered it. */
export type PageFillMeasurement = {
	query: string;
	means: string;
	/** Distinct foods the catalog holds for this query, capped at the page size. */
	available: number;
	/** Distinct foods the ranked search answered with. */
	returned: number;
};

/**
 * The key the `deduplicated` CTE collapses on: the name lowered, trimmed, and
 * with one trailing "s" dropped. `singular` is imported rather than copied
 * because it is the function that SQL mirrors, and its own docstring says so.
 *
 * SQLite's `lower` and `trim` fold ASCII only, while JavaScript's fold more. So
 * this key can merge two names SQLite would keep apart, never the reverse —
 * which means `availableFoods` can only report fewer foods than the catalog
 * really holds, never more. Reporting fewer weakens the guard; it cannot
 * invent a failure.
 */
export function collapseKey(name: string): string {
	return singular(name.trim().toLowerCase());
}

/**
 * Distinct lowered names to read before folding. At most two of them — "milk"
 * and "milks" — can share a collapse key, so twice the page size always yields
 * at least a page of keys; four times is margin for a future key that merges
 * more. The cap is what keeps this cheap: "chocolate" matches six figures of
 * rows and SQLite stops as soon as it has emitted this many distinct names.
 */
export const NAME_SCAN_FACTOR = 4;

/**
 * Candidate names for one FTS expression, distinct and bounded.
 *
 * Deliberately not ranked: this asks what the catalog holds, and the whole
 * point is to compare that against what the ranking returns.
 */
const candidateNamesSql = `
select distinct lower(trim(f.name)) as name
from food_fts join food f on f.food_id = food_fts.rowid
where food_fts match :match
limit :scan
`;

/**
 * How many distinct foods the catalog can offer for `match`, capped at `limit`.
 *
 * Capped because that is all the assertion needs: a query with 4,000 distinct
 * foods and one with 60 are both owed a full page, and counting either exactly
 * would mean scanning the whole match set for a number nothing reads.
 */
export function availableFoods(db: DatabaseSync, match: string, limit: number): number {
	const names = db
		.prepare(candidateNamesSql)
		.all({ match, scan: limit * NAME_SCAN_FACTOR })
		.map((row) => collapseKey(String(row['name'])));
	return Math.min(new Set(names).size, limit);
}

/**
 * The cases where the search lost foods the catalog has.
 *
 * `returned` can never exceed `available`, because collapsing names and cutting
 * to a page only ever remove rows, so this is an equality check written as the
 * inequality that can actually fire.
 */
export function pageFillViolations(measurements: PageFillMeasurement[]): PageFillMeasurement[] {
	return measurements.filter((measurement) => measurement.returned < measurement.available);
}

/** The measured page fill, as table rows: query, what the catalog has, what search answered. */
export function pageFillRows(measurements: PageFillMeasurement[]): string[][] {
	return [
		['query', 'catalog', 'search'],
		...measurements.map((measurement) => [
			measurement.query,
			String(measurement.available),
			String(measurement.returned)
		])
	];
}

/** The failure a collapse reads as, naming the query, the loss, and what it means. */
export function pageFillFailure(violations: PageFillMeasurement[], limit: number): string {
	const lines = violations.map(
		(violation) =>
			`${violation.query}: ${violation.returned} of ${violation.available} foods` +
			` (${violation.means})`
	);
	return (
		`#106: these queries no longer fill a page of ${limit}. The duplicate-name` +
		` collapse is losing foods the catalog has:\n  ${lines.join('\n  ')}`
	);
}
