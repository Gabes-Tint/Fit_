import { SEED_FOOD_BY_ID } from './foods';
import { RECIPE_BY_ID } from './recipes';
import type { PlannedMeal } from './types';

/** Aisles in walk order; `buildGrocery` sorts the list by this. */
const AISLES = [
	'Produce',
	'Meat, fish & alternatives',
	'Dairy',
	'Grains & bakery',
	'Pantry',
	'Drinks',
	'Packaged',
	'Other'
] as const;

export type Aisle = (typeof AISLES)[number];

const AISLE_BY_CATEGORY: Record<string, Aisle> = {
	produce: 'Produce',
	protein: 'Meat, fish & alternatives',
	dairy: 'Dairy',
	grain: 'Grains & bakery',
	fat: 'Pantry',
	condiment: 'Pantry',
	drink: 'Drinks',
	packaged: 'Packaged'
};

/** Translate a food category into its store aisle. */
export function groceryAisle(category: string): Aisle {
	return AISLE_BY_CATEGORY[category] ?? 'Other';
}

export type GroceryItem = {
	foodId: string;
	name: string;
	aisle: Aisle;
	servings: number;
	servingLabel: string;
	inPantry: boolean;
};

export function buildGrocery(plan: PlannedMeal[], pantry: string[]): GroceryItem[] {
	const map = new Map<string, number>();
	for (const slot of plan) {
		const recipe = RECIPE_BY_ID[slot.recipeId];
		if (!recipe) continue;
		for (const ing of recipe.ingredients) {
			const per = ing.servings / recipe.servings;
			map.set(ing.foodId, (map.get(ing.foodId) ?? 0) + per);
		}
	}
	const items: GroceryItem[] = [];
	for (const [foodId, servings] of map) {
		const food = SEED_FOOD_BY_ID[foodId];
		if (!food) continue;
		items.push({
			foodId,
			name: food.name,
			aisle: groceryAisle(food.category),
			servings: Math.round(servings * 4) / 4,
			servingLabel: food.servingLabel,
			inPantry: pantry.includes(foodId)
		});
	}
	items.sort((a, b) => {
		const d = AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle);
		return d !== 0 ? d : a.name.localeCompare(b.name);
	});
	return items;
}
