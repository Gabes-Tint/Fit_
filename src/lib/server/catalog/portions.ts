import type { ServingRow } from '$lib/domain/default-serving';
import { parsePortionLabel, type Portion } from '$lib/domain/portions';

/**
 * The household measures the catalog holds for a food, as weights the client
 * can scale by.
 *
 * `food_serving` is 3.5 million rows of free text — `2 Tbsp`, `1 Tbsp (15 ml)`,
 * `0.25 cup`, `1 PUDDING CUP`, `100 g` — and only a fraction of it states a
 * volume outright. `parsePortionLabel` is the one place that decides which, so
 * the server and the bundled catalog agree on what a label means; this module
 * is only the pick between competing rows.
 *
 * It reads no database of its own. The rows it needs are the rows
 * `default-serving.ts`, `unit-measure.ts` and `serving-options.ts` need, and
 * `foods.ts` fetches them once for the page and hands the same map to all four
 * — see `serving-rows.ts`. This module used to run `servingRowsSql` itself,
 * which made the endpoint ask `food_serving` the identical question four times
 * for one search.
 */

/** What one of each volume unit weighs, for one food's serving rows. */
function volumesOf(rows: readonly ServingRow[]): Portion[] {
	const portions: Portion[] = [];
	for (const row of rows) {
		const portion = parsePortionLabel(row.label, row.grams);
		if (portion === null) continue;
		// The first row naming a unit wins, which `servingRowsSql`'s `is_default
		// desc` makes the food's own serving rather than whichever row the table
		// holds first.
		if (!portions.some((each) => each.unit === portion.unit)) portions.push(portion);
	}
	return portions;
}

/**
 * The foods, each carrying what one of every volume unit weighs for it.
 *
 * Structural in the food rather than typed to `CatalogFood`: that type is
 * declared in `foods.ts`, which calls this, and naming it here would make the
 * two modules import each other.
 *
 * A page holding the same food twice reads the one map entry twice and both
 * copies answer, the same as every other reader of these rows.
 */
export function withPortions<T extends { id: number }>(
	rowsByFood: ReadonlyMap<number, ServingRow[]>,
	foods: readonly T[]
): (T & { portions: Portion[] })[] {
	return foods.map((food) => ({ ...food, portions: volumesOf(rowsByFood.get(food.id) ?? []) }));
}
