import { describe, expect, it } from 'vitest';
import {
	catalogFoodToFood,
	isCatalogFoodPayload,
	normalizeBarcode,
	type CatalogFoodPayload
} from './catalog-food';

/** A branded row in the shape `src/lib/server/catalog/foods.ts` hands back. */
const CEREAL: CatalogFoodPayload = {
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
};

describe('normalizeBarcode', () => {
	it('keeps a plain barcode', () => {
		expect(normalizeBarcode('00016000275287')).toBe('00016000275287');
	});

	it('accepts the shortest and longest barcode a package carries', () => {
		expect(normalizeBarcode('12345678')).toBe('12345678');
		expect(normalizeBarcode('12345678901234')).toBe('12345678901234');
	});

	it('drops the spaces a person types between groups of digits', () => {
		expect(normalizeBarcode(' 6026 5217 1032 ')).toBe('602652171032');
	});

	it('refuses a code too short to be a barcode', () => {
		expect(normalizeBarcode('1234567')).toBeNull();
	});

	it('refuses a code longer than fourteen digits', () => {
		expect(normalizeBarcode('123456789012345')).toBeNull();
	});

	it('refuses anything that is not digits', () => {
		expect(normalizeBarcode('cheerios')).toBeNull();
		expect(normalizeBarcode('6026521710a2')).toBeNull();
	});

	it('refuses an empty string', () => {
		expect(normalizeBarcode('   ')).toBeNull();
	});
});

describe('isCatalogFoodPayload', () => {
	it('accepts the row the endpoint sends', () => {
		expect(isCatalogFoodPayload(CEREAL)).toBe(true);
	});

	it('accepts a row whose optional columns are all null', () => {
		expect(
			isCatalogFoodPayload({
				...CEREAL,
				brand: null,
				category: null,
				barcode: null,
				serving: { label: null, grams: null },
				per100g: {
					kcal: 52,
					protein: null,
					fat: null,
					carbs: null,
					sugar: null,
					fiber: null,
					sodium: null,
					saturatedFat: null
				}
			})
		).toBe(true);
	});

	it('rejects a body that is not an object', () => {
		expect(isCatalogFoodPayload(null)).toBe(false);
		expect(isCatalogFoodPayload(undefined)).toBe(false);
		expect(isCatalogFoodPayload('HONEY NUT CHEERIOS')).toBe(false);
		expect(isCatalogFoodPayload(4213)).toBe(false);
		expect(isCatalogFoodPayload([CEREAL])).toBe(false);
	});

	it('rejects a row whose brand, category or barcode is not text', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, brand: 42 })).toBe(false);
		expect(isCatalogFoodPayload({ ...CEREAL, category: 42 })).toBe(false);
		expect(isCatalogFoodPayload({ ...CEREAL, barcode: 16000275287 })).toBe(false);
	});

	it('rejects a row whose kind or license is missing', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, kind: null })).toBe(false);
		expect(isCatalogFoodPayload({ ...CEREAL, license: null })).toBe(false);
	});

	it('rejects a serving label that is not text', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, serving: { label: 3, grams: 37 } })).toBe(false);
	});

	it('rejects a row whose serving is text rather than a pair of columns', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, serving: '3/4 cup' })).toBe(false);
	});

	it('rejects any nutrient that is neither a number nor absent', () => {
		for (const nutrient of ['protein', 'fat', 'carbs', 'sugar', 'fiber', 'sodium']) {
			expect(
				isCatalogFoodPayload({ ...CEREAL, per100g: { ...CEREAL.per100g, [nutrient]: 'lots' } })
			).toBe(false);
		}
	});

	it('rejects a row whose energy is text rather than a number', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, per100g: { ...CEREAL.per100g, kcal: '375' } })).toBe(
			false
		);
	});

	it('rejects a row with no name', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, name: 42 })).toBe(false);
	});

	it('rejects a row with no id', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, id: '4213' })).toBe(false);
	});

	it('rejects a row whose serving is missing', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, serving: null })).toBe(false);
	});

	it('rejects a row whose energy is missing, because nothing can be logged without it', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, per100g: { ...CEREAL.per100g, kcal: null } })).toBe(
			false
		);
	});

	it('rejects a row whose nutrients are missing entirely', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, per100g: null })).toBe(false);
	});

	it('rejects a text serving weight rather than reading it as grams', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, serving: { label: '3/4 cup', grams: '37' } })).toBe(
			false
		);
	});

	it('accepts a row carrying household measures, and one carrying none', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, portions: [{ unit: 'cup', grams: 49 }] })).toBe(true);
		expect(isCatalogFoodPayload({ ...CEREAL, portions: [] })).toBe(true);
		expect(isCatalogFoodPayload(CEREAL)).toBe(true);
	});

	it.each([
		['a unit no client can convert', [{ unit: 'handful', grams: 49 }]],
		['a unit that is not text', [{ unit: 4, grams: 49 }]],
		// `["cup"]` is a JSON value whose property key is "cup": without the text
		// check the table lookup accepts it and the client scales by a list.
		['a unit wrapped in a list', [{ unit: ['cup'], grams: 49 }]],
		['a weight that is not a number', [{ unit: 'cup', grams: '49' }]],
		['a measure that is not a pair of columns', ['1 cup']],
		['a list that is not a list', { cup: 49 }],
		[
			'one bad measure among good ones',
			[
				{ unit: 'cup', grams: 49 },
				{ unit: 'jar', grams: 400 }
			]
		]
	])('rejects household measures carrying %s', (_reason, portions) => {
		expect(isCatalogFoodPayload({ ...CEREAL, portions })).toBe(false);
	});

	it('rejects an inherited property name where a unit belongs', () => {
		expect(isCatalogFoodPayload({ ...CEREAL, portions: [{ unit: 'toString', grams: 49 }] })).toBe(
			false
		);
	});
});

describe('catalogFoodToFood', () => {
	it('scales the per-100 g nutrients onto the serving the catalog names', () => {
		const food = catalogFoodToFood(CEREAL);
		// 37 g of a 375 kcal/100 g cereal.
		expect(food.kcal).toBe(139);
		expect(food.protein).toBe(3);
		expect(food.carbs).toBe(29);
		expect(food.fat).toBe(1.7);
	});

	it('carries the serving label and weight through', () => {
		const food = catalogFoodToFood(CEREAL);
		expect(food.servingLabel).toBe('3/4 cup');
		expect(food.grams).toBe(37);
	});

	it('carries the household measures the catalog named', () => {
		const portions = [{ unit: 'cup' as const, grams: 49 }];
		expect(catalogFoodToFood({ ...CEREAL, portions }).portions).toEqual(portions);
	});

	it('names no measures at all rather than an empty list of them', () => {
		// `undefined` is what every bundled food says, so a catalog food the
		// catalog gave no measure for reads the same as one that never could.
		expect(catalogFoodToFood(CEREAL).portions).toBeUndefined();
		expect(catalogFoodToFood({ ...CEREAL, portions: [] }).portions).toBeUndefined();
	});

	it('scales the micronutrients the catalog carries', () => {
		const food = catalogFoodToFood(CEREAL);
		expect(food.micros.sugar).toBe(9);
		expect(food.micros.fiber).toBe(3);
		expect(food.micros.sodium).toBe(185);
	});

	it('leaves the micronutrients the catalog has no column for at zero', () => {
		expect(catalogFoodToFood(CEREAL).micros.potassium).toBe(0);
	});

	it('keeps the name, brand and barcode', () => {
		const food = catalogFoodToFood(CEREAL);
		expect(food.name).toBe('HONEY NUT CHEERIOS');
		expect(food.brand).toBe('GENERAL MILLS');
		expect(food.barcode).toBe('00016000275287');
	});

	it('marks the catalog id as a catalog id, so it is never mistaken for a bundled one', () => {
		expect(catalogFoodToFood(CEREAL).id).toBe('catalog-4213');
	});

	it('finds a branded row by name alone, having no aliases to offer', () => {
		expect(catalogFoodToFood(CEREAL).aliases).toEqual([]);
	});

	it('reads a branded row as a brand', () => {
		expect(catalogFoodToFood(CEREAL).provenance).toBe('brand');
	});

	it('reads a generic row as USDA', () => {
		expect(catalogFoodToFood({ ...CEREAL, kind: 'generic' }).provenance).toBe('usda');
	});

	it('reads a share-alike row as Open Food Facts, whatever its kind', () => {
		expect(catalogFoodToFood({ ...CEREAL, license: 'ODbL-1.0' }).provenance).toBe('off');
		expect(catalogFoodToFood({ ...CEREAL, kind: 'generic', license: 'ODbL-1.0' }).provenance).toBe(
			'off'
		);
	});

	it('falls back to 100 g, labelled explicitly, when the catalog names no serving weight', () => {
		const food = catalogFoodToFood({
			...CEREAL,
			serving: { label: null, grams: null }
		});
		expect(food.grams).toBe(100);
		expect(food.servingLabel).toBe('per 100 g');
		expect(food.kcal).toBe(375);
	});

	it('shows the server’s own fallback label rather than inventing its own', () => {
		// The server always sends an explicit label for the no-serving case
		// (#157); this only exercises the client's own fallback for a payload
		// that reached it without one.
		const food = catalogFoodToFood({
			...CEREAL,
			serving: { label: 'per 100 g', grams: null }
		});
		expect(food.servingLabel).toBe('per 100 g');
		expect(food.grams).toBe(100);
	});

	it('keeps a named serving even when its weight is unknown', () => {
		const food = catalogFoodToFood({ ...CEREAL, serving: { label: '1 bar', grams: null } });
		expect(food.servingLabel).toBe('1 bar');
		expect(food.grams).toBe(100);
	});

	it('reads a missing nutrient as zero rather than as NaN', () => {
		const food = catalogFoodToFood({
			...CEREAL,
			per100g: { ...CEREAL.per100g, protein: null, fat: null, carbs: null, sodium: null }
		});
		expect(food.protein).toBe(0);
		expect(food.fat).toBe(0);
		expect(food.carbs).toBe(0);
		expect(food.micros.sodium).toBe(0);
	});

	it('files a row the catalog does not categorize under "other"', () => {
		expect(catalogFoodToFood({ ...CEREAL, category: null }).category).toBe('other');
	});

	it('keeps the category the catalog gives', () => {
		expect(catalogFoodToFood(CEREAL).category).toBe('Breakfast Cereals');
	});

	it('leaves a row with no barcode without one', () => {
		expect(catalogFoodToFood({ ...CEREAL, barcode: null }).barcode).toBeUndefined();
	});

	it('leaves a row with no brand without one', () => {
		expect(catalogFoodToFood({ ...CEREAL, brand: null }).brand).toBeUndefined();
	});
});
