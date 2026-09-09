import { describe, expect, it } from 'vitest';
import { foodIdentity, isSameFood } from './food-identity';
import { logFromCatalogFood } from './log-entry';
import { ZERO_MICROS } from './types';
import type { Food } from './types';

function catalogFood(overrides: Partial<Food> = {}): Food {
	return {
		id: 'cat-9271',
		name: 'Nacho Cheese Tortilla Chips',
		brand: 'Doritos',
		aliases: [],
		category: 'snacks',
		provenance: 'off',
		servingLabel: '12 chips',
		grams: 28,
		kcal: 150,
		protein: 2,
		carbs: 18,
		fat: 8,
		micros: ZERO_MICROS,
		...overrides
	};
}

describe('foodIdentity', () => {
	it('reads one identity from a name and brand written two ways', () => {
		// An imported journal is not held to the catalog's spelling, and one
		// porridge that arrives as two rows is two remembered portions and two
		// History entries for the same breakfast.
		expect(foodIdentity({ name: ' Oatmeal ', brand: ' Quaker ' })).toBe(
			foodIdentity({ name: 'oatmeal', brand: 'QUAKER' })
		);
	});

	it('folds the name to lower case, not upper, in the key it reads', () => {
		// `fold` only has to agree with itself to make two spellings compare
		// equal, so an equality-only test (the case above) cannot tell lower-case
		// folding from upper-case folding apart -- both make 'Oatmeal' and
		// 'oatmeal' collide. Pinning the literal key is what catches a `fold`
		// that folds the other way.
		expect(foodIdentity({ name: 'Oatmeal' })).toBe('name:oatmeal|');
	});

	it('reads a missing brand and a blank one as the same absence of a brand', () => {
		expect(foodIdentity({ name: 'Oatmeal' })).toBe(foodIdentity({ name: 'Oatmeal', brand: '  ' }));
	});

	it('separates two brands of a food with one name', () => {
		expect(foodIdentity({ name: 'Yogurt', brand: 'Fage' })).not.toBe(
			foodIdentity({ name: 'Yogurt', brand: 'Store Brand' })
		);
	});

	it('separates two foods with different names', () => {
		expect(foodIdentity({ name: 'Yogurt' })).not.toBe(foodIdentity({ name: 'Kefir' }));
	});

	it('names a food that has a stable id by that id, whatever it is called now', () => {
		// A seeded food's id is hand-written and does not move, so a rename in
		// `seed-foods.ts` must not split a year of entries into two foods.
		expect(foodIdentity({ foodId: 'egg-large', name: 'Egg, large' })).toBe(
			foodIdentity({ foodId: 'egg-large', name: 'Large Egg' })
		);
	});

	it('separates two foods that each have their own id', () => {
		expect(foodIdentity({ foodId: 'egg-large', name: 'Egg' })).not.toBe(
			foodIdentity({ foodId: 'oats-rolled', name: 'Oats' })
		);
	});
});

describe('isSameFood', () => {
	it('matches a catalog food to the entry logging it produced', () => {
		// The rule this module exists for, put to the real builder rather than to
		// a hand-written entry: `logFromCatalogFood` stores no `foodId`, so an
		// identity keyed on the catalog's own id would match nothing a person has
		// ever eaten -- which is the mistake #159 shipped and its first end-to-end
		// run caught.
		const food = catalogFood();
		const item = logFromCatalogFood(food, {
			servings: 1.5,
			meal: 'snack',
			date: '2026-09-01',
			source: 'manual'
		});
		expect(item.foodId).toBeNull();
		expect(isSameFood(item, food)).toBe(true);
	});

	it('does not match an unbranded catalog food to a branded one of the same name', () => {
		const food = catalogFood({ brand: undefined });
		const item = logFromCatalogFood(catalogFood({ brand: 'Doritos' }), {
			servings: 1,
			meal: 'snack',
			date: '2026-09-01',
			source: 'manual'
		});
		expect(isSameFood(item, food)).toBe(false);
	});

	it('does not match an entry with an id of its own to a catalog row of the same name', () => {
		// A seeded egg and a catalog egg are two precisely different foods: one is
		// re-derived from `seed-foods.ts` on every rescale, the other carries its
		// own stored numbers.
		const seeded = logFromCatalogFood(catalogFood({ name: 'Egg, large' }), {
			servings: 1,
			meal: 'breakfast',
			date: '2026-09-01',
			source: 'manual'
		});
		expect(
			isSameFood({ ...seeded, foodId: 'egg-large' }, catalogFood({ name: 'Egg, large' }))
		).toBe(false);
	});
});
