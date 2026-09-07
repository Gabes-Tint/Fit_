import { SEED_FOODS } from './seed-foods';
import type { Micros, SeedFood } from './types';
import { round1 } from './utils';

// Seed rows live in `./seed-foods`; re-exported here so mutation testing targets behavior, not data.
export { PROVENANCE_LABEL, SEED_FOODS } from './seed-foods';

/**
 * The seeded foods by id.
 *
 * Only the sample journal, the recipe book and a seeded entry being re-portioned
 * reach for this, and every one of them holds an id already. There is no
 * by-name and no by-barcode index on purpose: since #146 finding a food is the
 * server catalog's job alone, and a second table to search was the dual path
 * that made "the app knows 49 foods" a thing anyone could observe.
 */
export const SEED_FOOD_BY_ID: Record<string, SeedFood> = Object.fromEntries(
	SEED_FOODS.map((food) => [food.id, food])
);

export function scaleFood(food: SeedFood, servings: number) {
	const s = servings;
	const micros = Object.fromEntries(
		Object.entries(food.micros).map(([k, v]) => [k, round1(v * s)])
	) as Micros;
	return {
		name: food.name,
		brand: food.brand,
		kcal: Math.round(food.kcal * s),
		protein: round1(food.protein * s),
		carbs: round1(food.carbs * s),
		fat: round1(food.fat * s),
		micros,
		provenance: food.provenance,
		servingLabel: food.servingLabel,
		foodId: food.id
	};
}
