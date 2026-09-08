import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { parsePortionLabel, type Portion } from '$lib/domain/portions';
import { servingRowsSql } from './serving-rows';
import { prepared } from './statements';

/**
 * The household measures the catalog holds for a food, as weights the client
 * can scale by.
 *
 * `food_serving` is 3.5 million rows of free text — `2 Tbsp`, `1 Tbsp (15 ml)`,
 * `0.25 cup`, `1 PUDDING CUP`, `100 g` — and only a fraction of it states a
 * volume outright. `parsePortionLabel` is the one place that decides which, so
 * the server and the bundled catalog agree on what a label means; this module
 * is only the query and the pick between competing rows.
 *
 * Separate from `foods.ts` because it reads a second table: the search returns
 * at most fifty rows and this reads all of their portions in one statement
 * through `idx_serving_food`. The statement itself is `serving-rows.ts`'s
 * `servingRowsSql` — the rows this needs are exactly the rows that module
 * already asks for, and its doc comment carries why the filter and the order
 * are what they are. Only the grouping below is this module's own.
 */

/** What one of each volume unit weighs, per food, from one read of their serving rows. */
function volumesByFood(catalog: DatabaseSync, ids: readonly number[]): Map<number, Portion[]> {
	const byFood = new Map<number, Portion[]>();
	if (ids.length === 0) return byFood;
	const rows: Record<string, SQLOutputValue>[] = prepared(catalog, servingRowsSql(ids.length)).all(
		...ids
	);
	for (const row of rows) {
		const portion = parsePortionLabel(String(row['label']), Number(row['grams']));
		if (portion === null) continue;
		const held = byFood.get(Number(row['food_id']));
		// The first row naming a unit wins, which `servingRowsSql`'s `is_default
		// desc` makes the food's own serving rather than whichever row the table
		// holds first.
		if (held === undefined) byFood.set(Number(row['food_id']), [portion]);
		else if (!held.some((each: Portion) => each.unit === portion.unit)) held.push(portion);
	}
	return byFood;
}

/**
 * The foods, each carrying what one of every volume unit weighs for it.
 *
 * Structural in the food rather than typed to `CatalogFood`: that type is
 * declared in `foods.ts`, which calls this, and naming it here would make the
 * two modules import each other.
 *
 * Ids are deduplicated on the way into the query and matched back by id on the
 * way out, so a page holding the same food twice reads it once and both copies
 * still answer.
 */
export function withPortions<T extends { id: number }>(
	catalog: DatabaseSync,
	foods: readonly T[]
): (T & { portions: Portion[] })[] {
	const byFood = volumesByFood(catalog, [...new Set(foods.map((food) => food.id))]);
	return foods.map((food) => ({ ...food, portions: byFood.get(food.id) ?? [] }));
}
