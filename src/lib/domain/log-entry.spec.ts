import { describe, expect, it } from 'vitest';
import { SEED_FOOD_BY_ID } from './foods';
import { catalogFoodToFood } from './catalog-food';
import { logFromCatalogFood, logFromFood, relogItem, rescaleLogItem } from './log-entry';
import { ZERO_MICROS } from './types';
import { round1 } from './utils';
import type { LogItem } from './types';

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

	it('has no grams, because a seed food never records a serving weight', () => {
		const item = logFromFood({
			foodId: 'egg-large',
			servings: 1,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'manual'
		});
		expect(item.grams).toBeUndefined();
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

	it('carries the serving’s own mass, unscaled by servings (#232)', () => {
		const one = logFromCatalogFood(CEREAL, {
			servings: 1,
			meal: 'breakfast',
			date: '2026-09-04',
			source: 'barcode'
		});
		const two = logFromCatalogFood(CEREAL, {
			servings: 2,
			meal: 'breakfast',
			date: '2026-09-04',
			source: 'barcode'
		});
		expect(one.grams).toBe(37);
		expect(two.grams).toBe(37);
	});
});

function customEntry(overrides: Partial<LogItem> = {}): LogItem {
	return {
		id: 'l-original',
		foodId: null,
		date: '2026-06-01',
		meal: 'lunch',
		servings: 2,
		source: 'manual',
		name: 'Leftovers',
		kcal: 400,
		protein: 20,
		carbs: 40,
		fat: 15,
		micros: { ...ZERO_MICROS, fiber: 4 },
		servingLabel: 'plate',
		...overrides
	};
}

describe('rescaleLogItem', () => {
	it('re-derives a seeded food through scaleFood rather than scaling its stored numbers', () => {
		const item = logFromFood({
			foodId: 'egg-large',
			servings: 0.5,
			meal: 'breakfast',
			date: '2026-06-01',
			source: 'manual'
		});
		const after = rescaleLogItem(item, 2);
		expect(after.servings).toBe(2);
		expect(after.kcal).toBe((SEED_FOOD_BY_ID['egg-large']?.kcal ?? 0) * 2);
		// Protein is what separates the two ways of getting here. Half an egg
		// stores 3.2g, rounded up from 3.15, and multiplying that stored figure
		// by the 4x ratio compounds the rounding into 12.8g; re-deriving from the
		// seed food gives the 12.6g two eggs actually have. Calories cannot tell
		// them apart -- 36 x 4 and 72 x 2 are both 144 -- so the assertion above
		// passes either way and this one is the one that holds the behavior.
		expect(after.protein).toBe(round1((SEED_FOOD_BY_ID['egg-large']?.protein ?? 0) * 2));
	});

	it('re-derives a seeded entry filed by an older build from today’s seed food', () => {
		// The state document is shared by devices running different builds, so an
		// entry can carry macros from a `seed-foods.ts` that has since changed.
		// Its `foodId` is the formula, and re-portioning is what re-applies it:
		// two eggs read as two of today’s eggs, not as double a stale one.
		const seed = SEED_FOOD_BY_ID['egg-large'];
		const stale = customEntry({
			foodId: 'egg-large',
			servings: 1,
			kcal: 60,
			protein: 5,
			carbs: 1,
			fat: 3
		});
		const after = rescaleLogItem(stale, 2);
		expect(after.servings).toBe(2);
		expect(after.kcal).toBe(Math.round((seed?.kcal ?? 0) * 2));
		expect(after.protein).toBe(round1((seed?.protein ?? 0) * 2));
		expect(after.carbs).toBe(round1((seed?.carbs ?? 0) * 2));
		expect(after.fat).toBe(round1((seed?.fat ?? 0) * 2));
	});

	it('scales a custom entry with no foodId by the servings ratio', () => {
		const after = rescaleLogItem(customEntry(), 3);
		expect(after.servings).toBe(3);
		expect(after.kcal).toBe(600);
		expect(after.protein).toBe(30);
		// Carbs and fat move with the ratio too. They are the two macros the day's
		// rings and the remaining-fat line read straight off the entry, so an edit
		// that left either at its old figure would misreport the day.
		expect(after.carbs).toBe(60);
		expect(after.fat).toBe(22.5);
		expect(after.micros.fiber).toBe(6);
	});

	it('leaves the stored macros alone when an entry logged at zero servings is rescaled', () => {
		const after = rescaleLogItem(customEntry({ servings: 0 }), 2);
		expect(after.servings).toBe(2);
		expect(after.kcal).toBe(400);
		expect(after.protein).toBe(20);
	});
});

describe('relogItem', () => {
	it('gives the new entry a different id than the one it was re-logged from', () => {
		const original = customEntry();
		const again = relogItem(original, { date: '2026-06-10', meal: 'dinner', servings: 2 });
		expect(again.id).not.toBe(original.id);
		expect(again.id.startsWith('l-')).toBe(true);
	});

	it('moves the entry to the given date and meal', () => {
		const again = relogItem(customEntry(), { date: '2026-06-10', meal: 'dinner', servings: 2 });
		expect(again.date).toBe('2026-06-10');
		expect(again.meal).toBe('dinner');
	});

	it('rescales the macros to the chosen servings using the same math as an edit', () => {
		const again = relogItem(customEntry(), { date: '2026-06-10', meal: 'lunch', servings: 1 });
		expect(again.servings).toBe(1);
		expect(again.kcal).toBe(200);
		expect(again.protein).toBe(10);
	});

	it('always logs a re-log as manual, since re-tapping a past entry is not typing, scanning or speaking', () => {
		const original = customEntry({ source: 'barcode' });
		const again = relogItem(original, { date: '2026-06-10', meal: 'lunch', servings: 2 });
		expect(again.source).toBe('manual');
	});

	it('drops the original note, since a note describes that occasion and not this one', () => {
		const original = customEntry({ note: 'half a bowl' });
		const again = relogItem(original, { date: '2026-06-10', meal: 'lunch', servings: 2 });
		expect(again.note).toBeUndefined();
	});

	it('does not divide by zero when re-logging an entry that was originally stored at zero servings', () => {
		const original = customEntry({ servings: 0 });
		const again = relogItem(original, { date: '2026-06-10', meal: 'lunch', servings: 2 });
		expect(again.servings).toBe(2);
		expect(again.kcal).toBe(400);
	});
});
