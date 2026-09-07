import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { pickUnitMeasure, type ServingRow } from '$lib/domain/unit-measure';
import { prepared } from './statements';

/**
 * The usable unit measure a food's household-measure rows carry, when one of
 * them names a genuine single countable item (#178) — "1.0 item 7.6 oz" for a
 * Big Mac, never "13 PIECE" for a tray of popcorn chicken.
 *
 * A third, separate query alongside `portions.ts` and `default-serving.ts`'s,
 * for the same reason those two stay apart from each other: each answers a
 * different question of the same `food_serving` rows, and keeping the
 * questions apart is what keeps each answer a single, small responsibility.
 * Still one batched statement for the page, not one per food.
 */

type Countable = { id: number };

function unitRowsSql(foods: number): string {
	return `select food_id, label, grams from food_serving
		where food_id in (${Array.from({ length: foods }, () => '?').join(', ')})
			and typeof(label) = 'text' and typeof(grams) in ('real', 'integer')
		order by food_id, is_default desc, label`;
}

/** Every household-measure row of a page of foods, grouped by food. */
function unitRowsByFood(catalog: DatabaseSync, ids: readonly number[]): Map<number, ServingRow[]> {
	const byFood = new Map<number, ServingRow[]>();
	if (ids.length === 0) return byFood;
	const rows: Record<string, SQLOutputValue>[] = prepared(catalog, unitRowsSql(ids.length)).all(
		...ids
	);
	for (const row of rows) {
		const id = Number(row['food_id']);
		const entry = { label: String(row['label']), grams: Number(row['grams']) };
		const held = byFood.get(id);
		if (held === undefined) byFood.set(id, [entry]);
		else held.push(entry);
	}
	return byFood;
}

/**
 * Every food, carrying the usable unit measure its rows named, or `null` when
 * none of them named a single countable item.
 */
export function withUnitMeasure<T extends Countable>(
	catalog: DatabaseSync,
	foods: readonly T[]
): (T & { unit: ServingRow | null })[] {
	const byFood = unitRowsByFood(catalog, [...new Set(foods.map((food) => food.id))]);
	return foods.map((food) => ({ ...food, unit: pickUnitMeasure(byFood.get(food.id) ?? []) }));
}
