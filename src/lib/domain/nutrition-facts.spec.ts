import { describe, expect, it } from 'vitest';
import {
	nutritionFactsForFood,
	nutritionFactsForLogItem,
	nutritionFactsRows
} from './nutrition-facts';
import { ZERO_MICROS, type Food, type LogItem, type NutrientBasis } from './types';

const FULL_BASIS: NutrientBasis = {
	kcal: 200,
	protein: 10,
	fat: 8,
	carbs: 20,
	saturatedFat: 2,
	fiber: 4,
	sugar: 6,
	sodium: 300,
	potassium: 400,
	iron: 2,
	calcium: 120,
	magnesium: 30,
	zinc: 1,
	vitaminA: 50,
	vitaminC: 10,
	vitaminD: 1,
	vitaminB12: 0.5
};

function byKey(rows: ReturnType<typeof nutritionFactsRows>) {
	return Object.fromEntries(rows.map((row) => [row.key, row]));
}

describe('nutritionFactsRows', () => {
	it('scales every field by grams/100', () => {
		const rows = byKey(nutritionFactsRows(FULL_BASIS, 50));
		expect(rows.kcal?.value).toBe(100);
		expect(rows.protein?.value).toBe(5);
		expect(rows.sodium?.value).toBe(150);
		expect(rows.potassium?.value).toBe(200);
		expect(rows.vitaminB12?.value).toBe(0.3);
	});

	it('returns the basis unchanged at 100 g, the basis it is stored on', () => {
		const rows = byKey(nutritionFactsRows(FULL_BASIS, 100));
		expect(rows.kcal?.value).toBe(200);
		expect(rows.calcium?.value).toBe(120);
	});

	it('scales up past 100 g just as it scales down', () => {
		const rows = byKey(nutritionFactsRows(FULL_BASIS, 200));
		expect(rows.kcal?.value).toBe(400);
		expect(rows.iron?.value).toBe(4);
	});

	it('keeps a null in the basis null, at any grams, rather than coercing it to zero', () => {
		const gap: NutrientBasis = { ...FULL_BASIS, potassium: null, vitaminD: null };
		const at50 = byKey(nutritionFactsRows(gap, 50));
		const at250 = byKey(nutritionFactsRows(gap, 250));
		expect(at50.potassium?.value).toBeNull();
		expect(at50.vitaminD?.value).toBeNull();
		expect(at250.potassium?.value).toBeNull();
		expect(at250.vitaminD?.value).toBeNull();
	});

	it('reads a field the payload omitted entirely the same as an explicit null', () => {
		const withoutPotassium: NutrientBasis = { ...FULL_BASIS, potassium: undefined };
		const rows = byKey(nutritionFactsRows(withoutPotassium, 100));
		expect(rows.potassium?.value).toBeNull();
	});

	it('names every row by its own field, not by a neighbor’s', () => {
		// Each field is looked up by its own key, so a row's key has to match the
		// basis field it actually scaled — a key typo would silently read as a
		// missing (`undefined`) row here rather than a wrong value.
		const rows = byKey(nutritionFactsRows(FULL_BASIS, 100));
		for (const [key, expected] of Object.entries(FULL_BASIS)) {
			expect(rows[key]?.value).toBe(expected);
		}
	});

	it('carries a unit and label on every row, macro or micro', () => {
		const rows = nutritionFactsRows(FULL_BASIS, 100);
		expect(rows.every((row) => row.unit.length > 0)).toBe(true);
		expect(rows.every((row) => row.label.length > 0)).toBe(true);
	});

	it('names sodium and potassium in milligrams and the fat-soluble vitamins in micrograms', () => {
		const rows = byKey(nutritionFactsRows(FULL_BASIS, 100));
		expect(rows.sodium?.unit).toBe('mg');
		expect(rows.potassium?.unit).toBe('mg');
		expect(rows.vitaminA?.unit).toBe('mcg');
		expect(rows.vitaminD?.unit).toBe('mcg');
		expect(rows.vitaminB12?.unit).toBe('mcg');
	});

	it('orders the macros before the micros, calories first', () => {
		const keys = nutritionFactsRows(FULL_BASIS, 100).map((row) => row.key);
		expect(keys.slice(0, 5)).toEqual(['kcal', 'protein', 'carbs', 'fat', 'saturatedFat']);
		expect(keys.indexOf('kcal')).toBeLessThan(keys.indexOf('fiber'));
	});

	it('returns the same order for every call', () => {
		const first = nutritionFactsRows(FULL_BASIS, 100).map((row) => row.key);
		const second = nutritionFactsRows(FULL_BASIS, 250).map((row) => row.key);
		expect(second).toEqual(first);
	});

	it('rounds a scaled value to one decimal place', () => {
		const rows = byKey(nutritionFactsRows({ ...FULL_BASIS, protein: 10 }, 33));
		expect(rows.protein?.value).toBe(3.3);
	});
});

function catalogFood(): Food {
	return {
		id: 'catalog-1',
		name: 'Catalog food',
		aliases: [],
		category: 'other',
		provenance: 'usda',
		servingLabel: '150 g',
		grams: 150,
		kcal: 300,
		protein: 15,
		carbs: 30,
		fat: 12,
		micros: { ...ZERO_MICROS, sodium: 450 },
		per100g: { ...FULL_BASIS, kcal: 200, sodium: 300, potassium: null }
	};
}

function bundledFood(): Food {
	return {
		id: 'egg-large',
		name: 'Egg, large',
		aliases: [],
		category: 'other',
		provenance: 'usda',
		servingLabel: '1 large',
		grams: 50,
		kcal: 72,
		protein: 6.3,
		carbs: 0.4,
		fat: 4.8,
		micros: { ...ZERO_MICROS, sodium: 71, potassium: 69 }
		// no per100g: bundled foods never carry the raw catalog basis.
	};
}

describe('nutritionFactsForFood', () => {
	it('scales the catalog basis onto the food’s own serving grams', () => {
		const rows = byKey(nutritionFactsForFood(catalogFood()));
		// 150 g of a 200 kcal/100 g food.
		expect(rows.kcal?.value).toBe(300);
		expect(rows.sodium?.value).toBe(450);
	});

	it('keeps a gap in the catalog basis null after scaling', () => {
		const rows = byKey(nutritionFactsForFood(catalogFood()));
		expect(rows.potassium?.value).toBeNull();
	});

	it('falls back to the food’s own final numbers when there is no catalog basis', () => {
		const rows = byKey(nutritionFactsForFood(bundledFood()));
		expect(rows.kcal?.value).toBe(72);
		expect(rows.sodium?.value).toBe(71);
		expect(rows.potassium?.value).toBe(69);
	});

	it('never reports a bundled food’s known-zero micro as a gap', () => {
		// ZERO_MICROS defaults every field this bundled food does not set to 0,
		// which is a real number here (the bundled data is complete), not a
		// missing one — so it must render as 0, not as an em dash.
		const rows = byKey(nutritionFactsForFood(bundledFood()));
		expect(rows.iron?.value).toBe(0);
	});
});

describe('nutritionFactsForLogItem', () => {
	function item(): LogItem {
		return {
			id: 'log-1',
			foodId: 'catalog-1',
			date: '2026-09-07',
			meal: 'lunch',
			servings: 1,
			source: 'manual',
			name: 'Logged food',
			kcal: 300,
			protein: 15,
			carbs: 30,
			fat: 12,
			micros: { ...ZERO_MICROS, sodium: 450, potassium: 200 },
			servingLabel: '150 g'
		};
	}

	it('reports the logged item’s own already-scaled totals', () => {
		const rows = byKey(nutritionFactsForLogItem(item()));
		expect(rows.kcal?.value).toBe(300);
		expect(rows.sodium?.value).toBe(450);
		expect(rows.potassium?.value).toBe(200);
	});

	it('does not rescale the logged totals a second time', () => {
		const rows = byKey(nutritionFactsForLogItem(item()));
		expect(rows.protein?.value).toBe(15);
	});
});
