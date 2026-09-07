import { describe, expect, it } from 'vitest';
import { SEED_FOOD_BY_ID } from './foods';
import { catalogFoodToFood } from './catalog-food';
import { logFromCatalogFood, logFromFood } from './log-entry';

describe('logFromFood', () => {
	it('builds an entry from a catalog food', () => {
		const item = logFromFood({
			foodId: 'egg-large',
			servings: 2,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'manual'
		});
		expect(item.kcal).toBe((SEED_FOOD_BY_ID['egg-large']?.kcal ?? 0) * 2);
	});

	it('carries the catalog food’s provenance onto the entry', () => {
		const item = logFromFood({
			foodId: 'egg-large',
			servings: 1,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'manual'
		});
		expect(item.provenance).toBe(SEED_FOOD_BY_ID['egg-large']?.provenance);
	});

	it('keeps the note it was given', () => {
		const item = logFromFood({
			foodId: 'egg-large',
			servings: 1,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'manual',
			note: 'soft boiled'
		});
		expect(item.note).toBe('soft boiled');
	});

	it('refuses to invent an entry for an unknown food, and names it', () => {
		expect(
			() =>
				logFromFood({
					foodId: 'not-a-food',
					servings: 1,
					meal: 'lunch',
					date: '2026-06-01',
					source: 'manual'
				})
			// The exact message, so that a guard which stopped guarding is not
			// mistaken for one: without it, `scaleFood` throws its own TypeError
			// on the missing food and the test passes either way.
		).toThrow('Unknown food: not-a-food');
	});

	it('gives the entry a log id', () => {
		const item = logFromFood({
			foodId: 'egg-large',
			servings: 1,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'manual'
		});
		expect(item.id.startsWith('l-')).toBe(true);
	});
});

describe('logFromCatalogFood', () => {
	const CEREAL = catalogFoodToFood({
		id: 4213,
		name: 'HONEY NUT CHEERIOS',
		brand: 'GENERAL MILLS',
		kind: 'branded',
		category: 'Breakfast Cereals',
		barcode: '00016000275287',
		license: 'PDDL-1.0',
		serving: { label: '3/4 cup', grams: 37 },
		per100g: {
			kcal: 375,
			protein: 8.1,
			fat: 4.5,
			carbs: 78.4,
			sugar: 24.3,
			fiber: 8.1,
			sodium: 500,
			saturatedFat: 0.7
		}
	});

	it('stores no food id, because the catalog does not promise to keep its own', () => {
		const item = logFromCatalogFood(CEREAL, {
			servings: 1,
			meal: 'breakfast',
			date: '2026-09-04',
			source: 'barcode'
		});
		expect(item.foodId).toBeNull();
	});

	it('carries the name, serving label and macros, so the entry stays right without one', () => {
		const item = logFromCatalogFood(CEREAL, {
			servings: 2,
			meal: 'breakfast',
			date: '2026-09-04',
			source: 'barcode'
		});
		expect(item.name).toBe('HONEY NUT CHEERIOS');
		expect(item.brand).toBe('GENERAL MILLS');
		expect(item.servingLabel).toBe('3/4 cup');
		expect(item.kcal).toBe(278);
		expect(item.protein).toBe(6);
	});

	it('keeps the meal, date, servings and source it was given', () => {
		const item = logFromCatalogFood(CEREAL, {
			servings: 0.5,
			meal: 'snack',
			date: '2026-09-01',
			source: 'barcode',
			note: 'half a bowl'
		});
		expect(item).toMatchObject({
			servings: 0.5,
			meal: 'snack',
			date: '2026-09-01',
			source: 'barcode',
			note: 'half a bowl'
		});
	});
});
