import { SEED_FOOD_BY_ID } from './foods';
import { RECIPES, type Recipe } from './recipe-book';
import type { Restriction } from './types';

// Seed rows live in `./recipe-book`; re-exported here so mutation testing targets behavior, not data.
export { RECIPES, type Recipe } from './recipe-book';

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(
	RECIPES.map((r) => [r.id, r])
);

export function recipeMacros(recipe: Recipe) {
	let kcal = 0;
	let protein = 0;
	let carbs = 0;
	let fat = 0;
	let fiber = 0;
	for (const ing of recipe.ingredients) {
		const food = SEED_FOOD_BY_ID[ing.foodId];
		if (!food) continue;
		const per = ing.servings / recipe.servings;
		kcal += food.kcal * per;
		protein += food.protein * per;
		carbs += food.carbs * per;
		fat += food.fat * per;
		fiber += food.micros.fiber * per;
	}
	return {
		kcal: Math.round(kcal),
		protein: Math.round(protein),
		carbs: Math.round(carbs),
		fat: Math.round(fat),
		fiber: Math.round(fiber * 10) / 10
	};
}

export function recipeFits(recipe: Recipe, restrictions: Restriction[]) {
	return restrictions.every((r) => recipe.suits.includes(r));
}
