import type { ServingRow } from '$lib/domain/default-serving';

/**
 * The serving choices a food's `food_serving` rows offer, reported exactly as
 * the catalog wrote them — a picker's raw material for MFP-style "4.0 oz" /
 * "1.0 medium breast" / "100 g" options, before any later slice does the
 * arithmetic that turns a choice plus a multiplier into a weight.
 *
 * A fourth question over the rows `foods.ts` fetches once per page, alongside
 * `default-serving.ts`'s, `unit-measure.ts`'s and `portions.ts`'s: where those
 * three each collapse a food's rows to the single row their own purpose needs,
 * this one is the odd member out — it keeps every row, because showing the
 * person their catalog-given choices is the whole point of it. It shares the
 * fetch rather than adding a second statement against the same table, for the
 * reason `serving-rows.ts` gives — as `portions.ts` shares the statement even
 * though it keeps its own grouping pass.
 */

export type ServingOption = { label: string; grams: number };

type Servable = { id: number };

/**
 * The heaviest a single serving row can plausibly be.
 *
 * Not a defense against the specific defect `portions.ts` documents — "1 tsp
 * (100 g)" is a label/weight mismatch this module never looks closely enough
 * to catch, because catching it would mean parsing the label into a volume,
 * which is `portions.ts`'s job and not this one's (this module reports rows,
 * it does not interpret them). This bound instead catches the coarser
 * failure: a row whose weight is corrupted or off by orders of magnitude — a
 * unit mistake upstream, a stray digit, milligrams read as grams. 10 kg is
 * comfortably above any real single serving the ETL sources report (a whole
 * rotisserie chicken is under 2 kg, a large cake under 3 kg) and comfortably
 * below what a magnitude error produces, so it never refuses real data.
 */
export const MAX_GRAMS = 10_000;

/** A weight a picker can show: finite, positive, and not an outlier by orders of magnitude. */
function isPlausibleWeight(grams: number): boolean {
	return Number.isFinite(grams) && grams > 0 && grams <= MAX_GRAMS;
}

/**
 * The key two rows are deduplicated on: the label with surrounding whitespace
 * trimmed and case folded away.
 *
 * The ETL is free text carried through from several sources, so the same
 * portion sometimes arrives spelled two ways for one food — "1 Cup" from one
 * row and "1 cup" from another. Neither spelling is more correct than the
 * other, so the first row seen wins and the rest are dropped as the same
 * choice restated, rather than the picker showing "1 Cup" and "1 cup" as if a
 * person could tell them apart.
 */
function dedupeKey(label: string): string {
	return label.trim().toLowerCase();
}

/**
 * How many serving choices a food can offer before the picker stops being
 * one.
 *
 * `food_serving` is free text from several sources merged together, so a food
 * with duplicate submissions across sources can carry dozens of rows that
 * differ only in rounding or phrasing. MyFitnessPal's own picker rarely shows
 * more than a handful; ten is generous room for a food with genuinely
 * distinct measures (weight, a cup, a slice, a whole item, …) without
 * becoming the wall of near-duplicates a raw, uncapped list would be.
 */
const MAX_OPTIONS = 10;

/**
 * A food's serving rows, reported verbatim as `{ label, grams }` in the
 * catalog's own order (`servingRowsSql`'s `is_default desc, label`),
 * implausible weights dropped, same-named rows collapsed to the first, and
 * capped at `MAX_OPTIONS`.
 *
 * Deliberately not reinterpreted the way `portions.ts`, `unit-measure.ts` and
 * `default-serving.ts` reinterpret these same rows: this is the one reader
 * whose job is to hand back what the catalog actually offered, not to pick a
 * winner from it.
 */
function servingOptionsOf(rows: readonly ServingRow[]): ServingOption[] {
	const seen = new Set<string>();
	const options: ServingOption[] = [];
	for (const row of rows) {
		if (options.length >= MAX_OPTIONS) break;
		if (!isPlausibleWeight(row.grams)) continue;
		const key = dedupeKey(row.label);
		if (seen.has(key)) continue;
		seen.add(key);
		options.push({ label: row.label, grams: row.grams });
	}
	return options;
}

/**
 * Every food, carrying the serving choices its rows named.
 *
 * Read from the map `foods.ts` fetches once for the page, the same as
 * `withPortions` does, so a page holding the same food twice reads one entry
 * twice and both copies still answer.
 */
export function withServingOptions<T extends Servable>(
	rowsByFood: ReadonlyMap<number, ServingRow[]>,
	foods: readonly T[]
): (T & { servingOptions: ServingOption[] })[] {
	return foods.map((food) => {
		const rows = rowsByFood.get(food.id);
		// `servingRowsByFood` only sets an entry for an id that had at least
		// one row (see `serving-rows.ts`), so a miss here means zero rows, not a
		// row to run past `servingOptionsOf`'s filters — reported directly as no
		// choices, the same answer filtering every row out would reach anyway.
		return { ...food, servingOptions: rows === undefined ? [] : servingOptionsOf(rows) };
	});
}
