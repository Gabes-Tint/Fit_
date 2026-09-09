import { pickDefaultServing, type ServingRow } from '$lib/domain/default-serving';

/**
 * The default serving a food's own row did not name, picked from its
 * `food_serving` measures instead of left as a silent 100 g (#157).
 *
 * A second, separate question from `portions.ts`'s, even though both read the
 * same rows (#178): that module answers what a *typed volume unit* weighs, for
 * foods that already name their own serving; this answers what a food with
 * *no* serving of its own should default to. Sharing the fetch does not merge
 * the questions — each still picks its own answer from the rows, and each
 * stays a single, small responsibility. The fetch itself is `foods.ts`'s, once
 * per page; see `serving-rows.ts`.
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
	rowsByFood: ReadonlyMap<number, ServingRow[]>,
	foods: readonly T[]
): T[] {
	return foods.map((food) => {
		if (food.serving.grams !== null) return food;
		const picked = pickDefaultServing(rowsByFood.get(food.id) ?? []);
		return { ...food, serving: picked ?? PER_100G };
	});
}
