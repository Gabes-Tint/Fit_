import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { pickDefaultServing, type ServingRow } from '$lib/domain/default-serving';
import { prepared } from './statements';

/**
 * The default serving a food's own row did not name, picked from its
 * `food_serving` measures instead of left as a silent 100 g (#157).
 *
 * A second, separate query from `portions.ts`'s rather than a shared one: that
 * module answers what a *typed volume unit* weighs, for foods that already
 * name their own serving; this answers what a food with *no* serving of its
 * own should default to. The two ask different questions of the same rows and
 * keeping them apart is what lets each stay a single, small responsibility —
 * both still cost one batched statement for the page, not one per food.
 */

type Servable = { id: number; serving: { label: string | null; grams: number | null } };

function servingRowsSql(foods: number): string {
	return `select food_id, label, grams from food_serving
		where food_id in (${Array.from({ length: foods }, () => '?').join(', ')})
			and typeof(label) = 'text' and typeof(grams) in ('real', 'integer')
		order by food_id, is_default desc, label`;
}

/** Every household-measure row of a page of foods, grouped by food. */
function servingRowsByFood(
	catalog: DatabaseSync,
	ids: readonly number[]
): Map<number, ServingRow[]> {
	const byFood = new Map<number, ServingRow[]>();
	if (ids.length === 0) return byFood;
	const rows: Record<string, SQLOutputValue>[] = prepared(catalog, servingRowsSql(ids.length)).all(
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
 * The explicit last resort: no household measure named itself a default, so
 * the card says so rather than showing a bare "100 g" as if the catalog had
 * chosen it.
 */
const PER_100G: Servable['serving'] = { label: 'per 100 g', grams: null };

/**
 * Every food, its own serving replaced with a household measure when it named
 * none. A food that already has a serving (its own `serving_g`, most Branded
 * and OFF rows) is returned unchanged — this only fills the gap SR Legacy,
 * Survey, Foundation and CNF rows leave.
 */
export function withDefaultServing<T extends Servable>(
	catalog: DatabaseSync,
	foods: readonly T[]
): T[] {
	const needing = foods.filter((food) => food.serving.grams === null);
	const byFood = servingRowsByFood(catalog, [...new Set(needing.map((food) => food.id))]);
	return foods.map((food) => {
		if (food.serving.grams !== null) return food;
		const picked = pickDefaultServing(byFood.get(food.id) ?? []);
		return { ...food, serving: picked ?? PER_100G };
	});
}
