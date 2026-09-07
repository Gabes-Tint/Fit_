/**
 * Choosing a default serving from a food's household measures, so a card
 * reads "1 sandwich (219 g)" rather than a 100 g nobody chose.
 *
 * `food_serving` always carries a "100 g" row — `build_db.py`'s ETL guarantees
 * one for every food, so a food can always be logged by weight — beside
 * whatever household measures the source itself gave (FDC's `food_portion.csv`,
 * or the food's own reported serving). That guaranteed row is not a household
 * measure a person asked for; it is the fallback this module exists to prefer
 * over, so it is filtered out before a choice is made rather than being one of
 * the candidates.
 */

export type ServingRow = { label: string; grams: number };

/** The ETL's own catch-all row — a bare weight, naming nothing a person chose. */
const PLAIN_GRAMS = /^\d+(\.\d+)?\s*g$/i;

/**
 * A whole-item measure: "1 sandwich", "1.0 item 7.6 oz", "1 slice". FDC's
 * `food_portion.csv` writes the count as "1.0", not "1", so both are read.
 */
const WHOLE_ITEM =
	/^1(?:\.0+)?\s+(item|sandwich|piece|each|serving|burger|slice|bar|cup|can|bottle|container)\b/i;

function hasWeight(row: ServingRow): boolean {
	return Number.isFinite(row.grams) && row.grams > 0;
}

/** Whether a row is a real household measure rather than the guaranteed 100 g catch-all. */
function isNamedMeasure(row: ServingRow): boolean {
	return hasWeight(row) && !PLAIN_GRAMS.test(row.label.trim());
}

/**
 * The default serving a food's household-measure rows suggest, or `null` when
 * none of them can serve as one — every row is the "100 g" catch-all, or the
 * food has no rows at all.
 *
 * `rows` is taken in the order the caller already decided between competing
 * candidates (the source's own default first, then label text, matching
 * `withPortions`'s ordering) — this function only chooses between rows it
 * considers equally good, never re-orders what it was given.
 */
export function pickDefaultServing(rows: readonly ServingRow[]): ServingRow | null {
	const named = rows.filter(isNamedMeasure);
	return named.find((row) => WHOLE_ITEM.test(row.label.trim())) ?? named[0] ?? null;
}
