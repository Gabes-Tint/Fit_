import type { DatabaseSync } from 'node:sqlite';
import { pickDefaultServing } from '$lib/domain/default-serving';
import { servingRowsByFood } from './serving-rows';

/**
 * The default serving a food's own row did not name, picked from its
 * `food_serving` measures instead of left as a silent 100 g (#157).
 *
 * A second, separate question from `portions.ts`'s, even though both now read
 * `servingRowsByFood` (#178): that module answers what a *typed volume unit*
 * weighs, for foods that already name their own serving; this answers what a
 * food with *no* serving of its own should default to. Sharing the fetch does
 * not merge the questions — each still picks its own answer from the rows,
 * and each stays a single, small responsibility.
 */

type Servable = { id: number; serving: { label: string | null; grams: number | null } };

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
