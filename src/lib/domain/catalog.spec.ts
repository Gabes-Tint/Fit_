import { describe, expect, it } from 'vitest';
import { PROVENANCE_LABEL, SEED_FOOD_BY_ID, SEED_FOODS, scaleFood } from './foods';
import { buildGrocery, groceryAisle } from './grocery';
import { RECIPE_BY_ID, RECIPES, recipeFits, recipeMacros, type Recipe } from './recipes';
import type { PlannedMeal, SeedFood } from './types';

/** Look a fixture up loudly, so a seed-food rename fails the test it belongs to. */
function food(id: string): SeedFood {
	const hit = SEED_FOOD_BY_ID[id];
	if (!hit) throw new Error(`test fixture references unknown food: ${id}`);
	return hit;
}

function firstRecipe(): Recipe {
	const hit = RECIPES[0];
	if (!hit) throw new Error('the recipe book is empty');
	return hit;
}

describe('the seeded foods', () => {
	it('is not empty', () => {
		expect(SEED_FOODS.length).toBeGreaterThan(0);
	});

	it('has no duplicate ids', () => {
		expect(new Set(SEED_FOODS.map((f) => f.id)).size).toBe(SEED_FOODS.length);
	});

	it('indexes every food by id', () => {
		expect(Object.keys(SEED_FOOD_BY_ID).length).toBe(SEED_FOODS.length);
	});

	it('labels every provenance it uses', () => {
		for (const food of SEED_FOODS) {
			expect(PROVENANCE_LABEL[food.provenance]).toBeDefined();
		}
	});

	it('gives every recipe ingredient an aisle to be bought in', () => {
		// The grocery list is the only thing that reads `category`, and an
		// ingredient with no aisle lands in "Other" -- the list saying it gave up
		// in front of someone standing in a shop. Only recipe ingredients get
		// there: `egg-mcmuffin` and `chipotle-bowl` are meals bought whole and
		// stay uncategorized on purpose.
		for (const r of RECIPES) {
			for (const ing of r.ingredients) {
				const food = SEED_FOOD_BY_ID[ing.foodId];
				expect(groceryAisle(food?.category ?? ''), `${r.id} -> ${ing.foodId}`).not.toBe('Other');
			}
		}
	});

	it('never leaves a food without energy and a serving label', () => {
		for (const food of SEED_FOODS) {
			expect(food.servingLabel.length).toBeGreaterThan(0);
			expect(food.kcal).toBeGreaterThanOrEqual(0);
		}
	});

	it('carries no field that would let it be searched', () => {
		// #146: the seeded rows are nutrition the sample journal and the recipe
		// book already know the ids of. An alias or a barcode creeping back in
		// is a second, 49-row food catalog re-forming beside the server's.
		for (const food of SEED_FOODS) {
			expect(food).not.toHaveProperty('aliases');
			expect(food).not.toHaveProperty('barcode');
		}
	});
});

describe('scaleFood', () => {
	it('leaves a single serving unchanged', () => {
		expect(scaleFood(food('egg-large'), 1).kcal).toBe(food('egg-large').kcal);
	});

	it('doubles energy for two servings', () => {
		expect(scaleFood(food('egg-large'), 2).kcal).toBe(food('egg-large').kcal * 2);
	});

	it('scales micronutrients alongside macros', () => {
		const single = scaleFood(food('broccoli'), 1);
		const double = scaleFood(food('broccoli'), 2);
		expect(double.micros.fiber).toBeCloseTo(single.micros.fiber * 2, 1);
	});

	it('zeroes out at zero servings', () => {
		expect(scaleFood(food('egg-large'), 0).kcal).toBe(0);
	});

	it('carries the provenance through', () => {
		expect(scaleFood(food('egg-large'), 1.5).provenance).toBe(food('egg-large').provenance);
	});
});

describe('the recipe book', () => {
	it('is not empty', () => {
		expect(RECIPES.length).toBeGreaterThan(0);
	});

	it('has no duplicate ids', () => {
		expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
	});

	it('indexes every recipe by id', () => {
		expect(Object.keys(RECIPE_BY_ID).length).toBe(RECIPES.length);
	});

	it('only references foods the seed table carries', () => {
		for (const r of RECIPES) {
			for (const ing of r.ingredients) {
				expect(SEED_FOOD_BY_ID[ing.foodId], `${r.id} -> ${ing.foodId}`).toBeDefined();
			}
		}
	});

	it('covers every planned meal slot', () => {
		for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
			expect(RECIPES.some((r) => r.meal === meal)).toBe(true);
		}
	});
});

describe('recipeMacros', () => {
	it('reports per-serving energy, not the whole pot', () => {
		const recipe = firstRecipe();
		const total = recipe.ingredients.reduce(
			(sum, ing) => sum + scaleFood(food(ing.foodId), ing.servings).kcal,
			0
		);
		expect(recipeMacros(recipe).kcal).toBeCloseTo(total / recipe.servings, 0);
	});

	it('reports every macro per serving, not just the energy', () => {
		// Stated by hand, not derived with the function's arithmetic, so a
		// swapped operand or a wrong-nutrient read shows up as a wrong number.
		const recipe = RECIPE_BY_ID['yogurt-bowl'];
		if (!recipe) throw new Error('test fixture references an unknown recipe');
		expect(recipeMacros(recipe)).toEqual({
			kcal: 200,
			protein: 20,
			carbs: 22,
			fat: 5,
			fiber: 5.9
		});
	});

	it('halves the plate when the pot serves two', () => {
		const recipe = RECIPE_BY_ID['yogurt-bowl'];
		if (!recipe) throw new Error('test fixture references an unknown recipe');
		const forTwo = recipeMacros({ ...recipe, servings: 2 });
		expect(forTwo.protein).toBe(10);
		expect(forTwo.kcal).toBe(100);
	});

	it('skips an ingredient the seed table no longer has, rather than counting it as zero-weight', () => {
		const recipe = firstRecipe();
		const withGhost: Recipe = {
			...recipe,
			ingredients: [...recipe.ingredients, { foodId: 'not-a-food', servings: 1 }]
		};
		expect(recipeMacros(withGhost)).toEqual(recipeMacros(recipe));
	});
});

describe('recipeFits', () => {
	it('accepts any recipe when nothing is restricted', () => {
		expect(RECIPES.every((r) => recipeFits(r, []))).toBe(true);
	});

	it('only returns vegetarian recipes under a vegetarian restriction', () => {
		const fitting = RECIPES.filter((r) => recipeFits(r, ['vegetarian']));
		expect(fitting.every((r) => r.suits.includes('vegetarian'))).toBe(true);
	});

	it('leaves at least one option under a single common restriction', () => {
		expect(RECIPES.some((r) => recipeFits(r, ['vegetarian']))).toBe(true);
	});
});

describe('groceryAisle', () => {
	it('maps a known category to its aisle', () => {
		expect(groceryAisle('produce')).toBe('Produce');
	});

	it('falls back to Other for an unknown category', () => {
		expect(groceryAisle('nonexistent-category')).toBe('Other');
	});

	it('maps condiments to the pantry', () => {
		expect(groceryAisle('condiment')).toBe('Pantry');
	});

	it('maps drinks to their own aisle', () => {
		expect(groceryAisle('drink')).toBe('Drinks');
	});

	it('maps packaged foods to their own aisle', () => {
		expect(groceryAisle('packaged')).toBe('Packaged');
	});
});

describe('buildGrocery', () => {
	const plan: PlannedMeal[] = RECIPES.slice(0, 3).map((r, i) => ({
		date: `2026-06-0${i + 1}`,
		meal: 'dinner',
		recipeId: r.id,
		forProfileIds: ['p1']
	}));

	it('produces a list from a plan', () => {
		expect(buildGrocery(plan, []).length).toBeGreaterThan(0);
	});

	it('lists each food once, with the servings combined', () => {
		const items = buildGrocery(plan, []);
		expect(new Set(items.map((i) => i.foodId)).size).toBe(items.length);
	});

	it('adds up an ingredient that two meals both call for', () => {
		const twice: PlannedMeal[] = [
			{ date: '2026-06-01', meal: 'breakfast', recipeId: 'yogurt-bowl', forProfileIds: ['p1'] },
			{ date: '2026-06-02', meal: 'breakfast', recipeId: 'yogurt-bowl', forProfileIds: ['p1'] }
		];
		const list = buildGrocery(twice, []);
		expect(list.map((i) => [i.foodId, i.servings, i.aisle])).toEqual([
			['blueberries', 1, 'Produce'],
			['greek-yogurt', 2, 'Dairy'],
			['chia', 2, 'Pantry']
		]);
	});

	it('rounds an awkward quantity to a quarter serving you can actually buy', () => {
		// The taco asks for 1.2 servings of ground turkey; a list can't say 1.2.
		const tacos: PlannedMeal[] = [
			{ date: '2026-06-01', meal: 'dinner', recipeId: 'turkey-taco', forProfileIds: ['p1'] }
		];
		const turkey = buildGrocery(tacos, []).find((i) => i.foodId === 'ground-turkey');
		expect(turkey?.servings).toBe(1.25);
	});

	it('marks pantry items without removing them from the list', () => {
		const firstId = buildGrocery(plan, [])[0]?.foodId ?? '';
		const withPantry = buildGrocery(plan, [firstId]);
		expect(withPantry.find((i) => i.foodId === firstId)?.inPantry).toBe(true);
	});

	it('groups the list so each aisle appears in one run', () => {
		const aisles = buildGrocery(plan, []).map((i) => i.aisle);
		const runs = aisles.filter((a, i) => a !== aisles[i - 1]);
		expect(new Set(runs).size).toBe(runs.length);
	});

	it('returns nothing for an empty plan', () => {
		expect(buildGrocery([], [])).toEqual([]);
	});

	it('skips a plan slot whose recipe no longer exists', () => {
		const stale: PlannedMeal[] = [
			{ date: '2026-06-01', meal: 'dinner', recipeId: 'gone', forProfileIds: ['p1'] }
		];
		expect(buildGrocery(stale, [])).toEqual([]);
	});
});
