import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureCatalog } from '../../../../tests/catalog-fixture';
import { foodsByBarcode, pageSize, searchFoods } from './foods';

let db: DatabaseSync;

/**
 * Insert a row whose trailing columns are written literally, so a column can
 * carry a value of the wrong type. Everything after `license` is defaulted by
 * the caller's own text.
 */
function malformed(id: number, name: string, tail: string): void {
	db.exec(
		`insert into food (food_id, name, brand, category, kind, region, license,
			serving_label, serving_g, kcal, quality, n_sources)
		values (${id}, '${name}', ${tail})`
	);
	db.exec(`insert into food_fts (rowid, name, brand, aliases) values (${id}, '${name}', '', '')`);
}

const names = (typed: string, limit = 10) => searchFoods(db, typed, limit).map((food) => food.name);

beforeEach(() => {
	db = createFixtureCatalog();
});

afterEach(() => {
	db.close();
});

describe('the defect this ranking exists for', () => {
	it('is reproduced by the fixture: quality alone answers "milk" with chocolate', () => {
		const byQuality = db
			.prepare(
				`select f.name from food_fts join food f on f.food_id = food_fts.rowid
				where food_fts match '"milk"*' order by f.quality desc limit 3`
			)
			.all()
			.map((row) => row['name']);
		expect(byQuality).toEqual([
			'TORN & GLASSER, MILK CHOCOLATE PRETZELS',
			'ORGANIC PLAIN WHOLE MILK YOGURT',
			'MILK'
		]);
	});
});

describe('searchFoods', () => {
	it('puts plain milk above milk chocolate pretzels', () => {
		expect(names('milk')).toEqual([
			'MILK',
			'Milk, whole',
			'Milk, dried',
			'ORGANIC PLAIN WHOLE MILK YOGURT',
			'TORN & GLASSER, MILK CHOCOLATE PRETZELS'
		]);
	});

	it('shows one food per name, not the same food under five dairies', () => {
		expect(names('milk').filter((name) => name === 'MILK')).toHaveLength(1);
	});

	it('keeps the highest-quality row of a duplicated name', () => {
		const milk = searchFoods(db, 'milk', 10).find((food) => food.name === 'MILK');
		expect(milk?.brand).toBe('NORTH VALLEY DAIRY');
	});

	it('demotes a preserved form below the plain food', () => {
		const ranked = names('milk');
		expect(ranked.indexOf('Milk, dried')).toBeGreaterThan(ranked.indexOf('Milk, whole'));
	});

	it('answers "chicken" with chicken rather than with feet and giblets', () => {
		expect(names('chicken')).toEqual([
			'Chicken',
			'Chicken, ground, raw',
			'Chicken, stewing, meat only, raw',
			'Chicken, feet, boiled',
			'Chicken, stewing, giblets, raw'
		]);
	});

	it('still answers "chicken feet" with chicken feet: this is a demotion, not a filter', () => {
		expect(names('chicken feet')).toEqual(['Chicken, feet, boiled']);
	});

	it('answers with a full page when one name is carried by more rows than the shortlist holds', () => {
		// The fixture holds 501 rows named "PASTA" and three other pasta foods
		// behind them. While the duplicate-name collapse ran after the shortlist
		// was cut, the crowd filled the cut and then became one row, so this
		// answered with a single food — which is what the live catalog did.
		expect(names('pasta', 4)).toEqual([
			'PASTA',
			'Pasta, dry, enriched',
			'Pasta, fresh-refrigerated, plain, cooked',
			'Pasta (spaghetti, macaroni), enriched, dry'
		]);
	});

	it('still shows a crowded name once, which is what the collapse is for', () => {
		expect(names('pasta', 4).filter((name) => name === 'PASTA')).toHaveLength(1);
	});

	it('matches a singular catalog name from a plural query', () => {
		// "beef livers" reached FTS as `"livers"*`, and a prefix cannot match
		// "liver" backwards, so the catalog's own liver row was unreachable.
		expect(names('beef livers')).toEqual(['Beef, liver, raw']);
	});

	it('keeps the token a person typed as well as its singular', () => {
		// "TURKEY GIZZARDS" is only found by the plural, "Turkey, all classes,
		// gizzard, raw" only by the singular. Both have to come back.
		expect(names('turkey gizzards')).toEqual([
			'TURKEY GIZZARDS',
			'Turkey, all classes, gizzard, raw'
		]);
	});

	it('still exempts a part the person named, when they named it in the plural', () => {
		// The demotion reads the typed text, not the match expression, so
		// widening the match must not turn the exemption off.
		expect(names('beef livers')).toContain('Beef, liver, raw');
		expect(names('beef')[0]).toBe('Beef, ground, 80% lean meat / 20% fat, raw');
	});

	it('matches a plural catalog name from a singular query', () => {
		expect(names('banana')).toEqual(['Bananas, raw', 'Banana, baked', 'BANANA BREAD MIX']);
	});

	it('puts a reference food above a survey composite of the same head word', () => {
		const ranked = names('banana');
		expect(ranked.indexOf('Bananas, raw')).toBeLessThan(ranked.indexOf('Banana, baked'));
	});

	it('finds a food through an alias it is indexed under', () => {
		expect(names('paneer')).toEqual(['Cheese, curd']);
	});

	it('carries the provenance and the per-100 g numbers a logged entry keeps', () => {
		const [food] = searchFoods(db, 'milk', 1);
		expect(food).toEqual({
			id: 3,
			name: 'MILK',
			brand: 'NORTH VALLEY DAIRY',
			kind: 'branded',
			category: 'Test',
			barcode: '00000000000035',
			license: 'public-domain',
			serving: { label: 'serving', grams: 100 },
			portions: [],
			per100g: {
				kcal: 100,
				protein: 5,
				fat: 3,
				carbs: 12,
				sugar: 4,
				fiber: 1,
				sodium: 50,
				saturatedFat: 1,
				potassium: 150,
				iron: 1.2,
				calcium: 120,
				magnesium: 15,
				zinc: 0.8,
				vitaminA: 40,
				vitaminC: 5,
				vitaminD: 0.2,
				vitaminB12: 0.6
			},
			quality: 94,
			sources: 9
		});
	});

	it('carries what one of each volume unit weighs for the food', () => {
		// "1 cup" weighing 244 g. The fixture also holds "2 cup" at 500 g, which
		// names the same unit; the food's own serving rows are read in order and
		// the first to name a unit is the one kept.
		const found = searchFoods(db, 'whole milk', 5).find((food) => food.id === 4);
		expect(found?.portions).toEqual([{ unit: 'cup', grams: 244 }]);
	});

	it('leaves out a serving row that states no volume', () => {
		// "1 PUDDING CUP" and "100 g" are both `food_serving` rows on this food.
		const found = searchFoods(db, 'whole milk', 5).find((food) => food.id === 4);
		expect(found?.portions?.map((portion) => portion.unit)).toEqual(['cup']);
	});

	it('carries the portions of a food a barcode names', () => {
		const [found] = foodsByBarcode(db, '00000000000103');
		expect(found?.portions).toEqual([
			{ unit: 'tsp', grams: 5.3 },
			{ unit: 'tbsp', grams: 16 }
		]);
	});

	it('carries an empty list for a food the catalog gave no household measure', () => {
		const [found] = foodsByBarcode(db, '00000000000035');
		expect(found?.portions).toEqual([]);
	});

	it('reads a column whose type has changed as absent rather than guessing', () => {
		// A brand arriving as a blob and a serving weight as text. The catalog is
		// rebuilt by an ETL this module does not own, so a column that changes
		// shape has to read as missing rather than reach the client as raw bytes
		// where a brand belongs.
		malformed(
			9001,
			'Barley, raw',
			"x'07', 'Test', 'generic', 'US', 'public-domain', 'serving', 'a lot', 100.0, 91, 1"
		);
		const [food] = searchFoods(db, 'barley', 1);
		expect(food?.brand).toBeNull();
		expect(food?.serving.grams).toBeNull();
	});

	it('sends a #175 micro the row never set as null rather than coercing it to zero', () => {
		// The same malformed row above sets no potassium column at all — closer
		// to the live catalog's coverage gaps than a row this fixture curated.
		malformed(
			9003,
			'Oats, raw',
			"x'07', 'Test', 'generic', 'US', 'public-domain', 'serving', 'a lot', 100.0, 91, 1"
		);
		const [food] = searchFoods(db, 'oats', 1);
		expect(food?.per100g.potassium).toBeNull();
	});

	it('refuses a row whose required number is not a number', () => {
		malformed(
			9002,
			'Millet, raw',
			"null, 'Test', 'generic', 'US', 'public-domain', 'serving', 100.0, 'unknown', 91, 1"
		);
		expect(() => searchFoods(db, 'millet', 1)).toThrow(/kcal/);
	});

	it('honours the requested page size', () => {
		expect(names('milk', 2)).toEqual(['MILK', 'Milk, whole']);
	});

	it('answers nothing for a query with no searchable token', () => {
		expect(searchFoods(db, 'a', 10)).toEqual([]);
	});

	it('answers nothing for a word the catalog does not hold', () => {
		expect(searchFoods(db, 'quinoa', 10)).toEqual([]);
	});
});

describe('pageSize', () => {
	it('defaults when nothing was asked for', () => {
		expect(pageSize(null)).toBe(20);
	});

	it('defaults for a size that is not a whole number of rows', () => {
		expect(pageSize('ten')).toBe(20);
		expect(pageSize('2.5')).toBe(20);
		expect(pageSize('0')).toBe(20);
		expect(pageSize('-5')).toBe(20);
	});

	it('caps a caller that asks for the whole catalog', () => {
		expect(pageSize('5000')).toBe(50);
	});

	it('honours a size within the cap', () => {
		expect(pageSize('7')).toBe(7);
	});

	it('honours a caller that asks for a single row', () => {
		expect(pageSize('1')).toBe(1);
	});
});

describe('foodsByBarcode', () => {
	it('returns the one food a barcode names', () => {
		expect(foodsByBarcode(db, '00000000000035').map((food) => food.name)).toEqual(['MILK']);
	});

	it('returns every food sharing a duplicated barcode rather than picking one', () => {
		expect(foodsByBarcode(db, '00000000000103').map((food) => food.name)).toEqual([
			'GRANOLA BAR, CHOCOLATE',
			'GRANOLA BAR, PEANUT'
		]);
	});

	it('returns nothing for a barcode the catalog does not carry', () => {
		expect(foodsByBarcode(db, '00000000009999')).toEqual([]);
	});
});
