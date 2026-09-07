import type { DatabaseSync } from 'node:sqlite';
import { pickUnitMeasure, type ServingRow } from '$lib/domain/unit-measure';
import { servingRowsByFood } from './serving-rows';

/**
 * The usable unit measure a food's household-measure rows carry, when one of
 * them names a genuine single countable item (#178) — "1.0 item 7.6 oz" for a
 * Big Mac, never "13 PIECE" for a tray of popcorn chicken.
 *
 * A third question over the rows `servingRowsByFood` fetches, alongside
 * `default-serving.ts`'s: each still picks its own answer from the same
 * rows, and keeping the questions apart is what keeps each answer a single,
 * small responsibility.
 */

type Countable = { id: number };

/**
 * Every food, carrying the usable unit measure its rows named, or `null` when
 * none of them named a single countable item.
 */
export function withUnitMeasure<T extends Countable>(
	catalog: DatabaseSync,
	foods: readonly T[]
): (T & { unit: ServingRow | null })[] {
	const byFood = servingRowsByFood(catalog, [...new Set(foods.map((food) => food.id))]);
	return foods.map((food) => ({ ...food, unit: pickUnitMeasure(byFood.get(food.id) ?? []) }));
}
