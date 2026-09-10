import { DatabaseSync } from 'node:sqlite';

/**
 * A catalog of a dozen rows, in the shape `data/scripts/build_db.py` builds.
 *
 * It lives beside `e2e-support.ts` rather than under `src/`, because it is test
 * data: nothing the application ships imports it, and a mutant in a row is a
 * changed food name rather than a defect any test should be asserting.
 *
 * It exists so the ranking is asserted rather than hoped for. The real catalog
 * is a 365 MB file that is not in the repository and not in CI, so the rows
 * here are chosen to reproduce the defect it exhibits: ordered by `quality`
 * alone, "milk" answers with milk chocolate pretzels and a yogurt before it
 * answers with milk, and "banana" answers with a bread mix before the fruit.
 *
 * Every column the ranking reads is real: `quality` 94 for branded rows and 90
 * or 91 for generic ones is the inversion the live data has, and `n_sources`
 * 247 on "Milk, whole" is its actual value.
 */
type FixtureRow = {
	id: number;
	name: string;
	brand: string | null;
	kind: 'branded' | 'generic';
	quality: number;
	sources: number;
	barcode: string | null;
	alias: string | null;
	/** `food_serving` rows, as free text with the weight the source gave. */
	servings?: [label: string, grams: number][];
};

const FIXTURE_FOODS: FixtureRow[] = [
	{
		id: 1,
		name: 'TORN & GLASSER, MILK CHOCOLATE PRETZELS',
		brand: 'TORN & GLASSER',
		kind: 'branded',
		quality: 94,
		sources: 8,
		barcode: '00000000000011',
		alias: null
	},
	{
		id: 2,
		name: 'ORGANIC PLAIN WHOLE MILK YOGURT',
		brand: null,
		kind: 'branded',
		quality: 94,
		sources: 7,
		barcode: '00000000000028',
		alias: null
	},
	{
		id: 3,
		name: 'MILK',
		brand: 'NORTH VALLEY DAIRY',
		kind: 'branded',
		quality: 94,
		sources: 9,
		barcode: '00000000000035',
		alias: null
	},
	{
		id: 4,
		name: 'Milk, whole',
		brand: null,
		kind: 'generic',
		quality: 90,
		sources: 247,
		barcode: null,
		alias: 'whole milk',
		// A volume the label states outright, a competing row for the same unit,
		// and two the parser must refuse.
		servings: [
			['1 cup', 244],
			['2 cup', 500],
			['1 PUDDING CUP', 99],
			['100 g', 100]
		]
	},
	// Same name as row 3 under another dairy: without the duplicate-name pass a
	// person searching "milk" sees one food twice.
	{
		id: 5,
		name: 'MILK',
		brand: 'WEST HILL',
		kind: 'branded',
		quality: 87,
		sources: 5,
		barcode: '00000000000059',
		alias: null
	},
	// A preserved form, built to win on every other term: as short as
	// "Milk, whole", generic, in the reference tier it is not in, and better
	// corroborated. Only the processed-form penalty keeps it below plain milk.
	{
		id: 6,
		name: 'Milk, dried',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 300,
		barcode: null,
		alias: null
	},
	// Plural in the catalog, singular in the query.
	{
		id: 7,
		name: 'Bananas, raw',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 1,
		barcode: null,
		alias: null
	},
	{
		id: 8,
		name: 'BANANA BREAD MIX',
		brand: "TRADER JOE'S",
		kind: 'branded',
		quality: 94,
		sources: 6,
		barcode: '00000000000080',
		alias: null
	},
	// A survey composite: generic like row 7, but below the reference tier.
	{
		id: 9,
		name: 'Banana, baked',
		brand: null,
		kind: 'generic',
		quality: 90,
		sources: 1,
		barcode: null,
		alias: null
	},
	// Two foods, one barcode: what `validate.py` reports 30 of.
	{
		id: 10,
		name: 'GRANOLA BAR, CHOCOLATE',
		brand: 'BRAND A',
		kind: 'branded',
		quality: 94,
		sources: 4,
		barcode: '00000000000103',
		alias: null,
		servings: [
			['2 Tbsp', 32],
			['1 tsp', 5.3],
			// A genuine single-item measure (#178), beside the volume rows above.
			['1 bar', 40]
		]
	},
	{
		id: 11,
		name: 'GRANOLA BAR, PEANUT',
		brand: 'BRAND B',
		kind: 'branded',
		quality: 87,
		sources: 3,
		barcode: '00000000000103',
		alias: null
	},
	// The live catalog answers "chicken" with chicken, ground chicken, then feet
	// and two lots of giblets. These five rows carry the real quality and source
	// counts of those rows, so the byproduct demotion is asserted against the
	// numbers it has to overcome rather than against invented ones.
	{
		id: 13,
		name: 'Chicken',
		brand: null,
		kind: 'generic',
		quality: 88,
		sources: 4,
		barcode: null,
		alias: null
	},
	{
		id: 14,
		name: 'Chicken, ground, raw',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 121,
		barcode: null,
		alias: null
	},
	{
		id: 15,
		name: 'Chicken, feet, boiled',
		brand: null,
		kind: 'generic',
		quality: 92,
		sources: 2,
		barcode: null,
		alias: null
	},
	{
		id: 16,
		name: 'Chicken, stewing, giblets, raw',
		brand: null,
		kind: 'generic',
		quality: 92,
		sources: 2,
		barcode: null,
		alias: null
	},
	{
		id: 17,
		name: 'Chicken, stewing, meat only, raw',
		brand: null,
		kind: 'generic',
		quality: 92,
		sources: 2,
		barcode: null,
		alias: null
	},
	// A part the catalog writes singular, so a query that writes it plural has
	// something to fail to find: "beef livers" reached FTS as `"livers"*`, which
	// a prefix search cannot match against "liver", and answered with nothing.
	{
		id: 18,
		name: 'Beef, liver, raw',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 2,
		barcode: null,
		alias: null
	},
	{
		id: 19,
		name: 'Beef, ground, 80% lean meat / 20% fat, raw',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 8,
		barcode: null,
		alias: null
	},
	// The same in the other direction: the catalog writes "gizzard" and the
	// packet writes "GIZZARDS", so the plural query has to find both.
	{
		id: 20,
		name: 'Turkey, all classes, gizzard, raw',
		brand: null,
		kind: 'generic',
		quality: 92,
		sources: 2,
		barcode: null,
		alias: null
	},
	{
		id: 21,
		name: 'TURKEY GIZZARDS',
		brand: 'BRAND C',
		kind: 'branded',
		quality: 94,
		sources: 1,
		barcode: null,
		alias: null
	},
	// Three foods behind the crowd below. They outscore nothing it holds, so
	// they only come back if the duplicate-name collapse runs before the cut.
	{
		id: 22,
		name: 'Pasta, dry, enriched',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 3,
		barcode: null,
		alias: null
	},
	{
		id: 23,
		name: 'Pasta (spaghetti, macaroni), enriched, dry',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 2,
		barcode: null,
		alias: null
	},
	{
		id: 24,
		name: 'Pasta, fresh-refrigerated, plain, cooked',
		brand: null,
		kind: 'generic',
		quality: 90,
		sources: 1,
		barcode: null,
		alias: null
	},
	// #337, whole. The candy is a branded row named exactly what a person types,
	// and the fruit is written the way the reference set writes it — head word
	// first, variety after — so no generic row carries the word "green" at all.
	// Nothing can be re-ranked into first place that the strict match never
	// held, which is why the head-noun retry exists beside the demotion.
	{
		id: 25,
		name: 'GREEN APPLE',
		brand: 'CLAEYS',
		kind: 'branded',
		quality: 94,
		sources: 7,
		barcode: '00000000000257',
		alias: null,
		servings: [['3 pieces', 15]]
	},
	{
		id: 26,
		name: 'Apples, granny smith, with skin, raw',
		brand: null,
		kind: 'generic',
		quality: 93,
		sources: 218,
		barcode: null,
		alias: null
	},
	// The compound food the head-noun widening must never answer for (#337
	// review): nothing generic carries both words, so a widening that outranked
	// the strict page would put 360 kcal of plain rice above a 24 kcal
	// vegetable — the same harm the candy did, in the other direction.
	{
		id: 27,
		name: 'CAULIFLOWER RICE',
		brand: 'WEGMANS',
		kind: 'branded',
		quality: 94,
		sources: 3,
		barcode: null,
		alias: null
	},
	{
		id: 28,
		name: 'Rice, white, long-grain, regular, raw, enriched',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 200,
		barcode: null,
		alias: null
	},
	// Found only through its alias, which is a separate FTS column.
	{
		id: 12,
		name: 'Cheese, curd',
		brand: null,
		kind: 'generic',
		quality: 91,
		sources: 1,
		barcode: null,
		alias: 'paneer'
	}
];

/**
 * One name carried by more rows than the ranking's shortlist holds.
 *
 * This is the shape of a defect rather than a food. On the live catalog 724 rows
 * are named "PEANUT BUTTER" and hundreds "PASTA"; they are branded, so they
 * outscore the generic rows behind them, and they all score alike. While the
 * duplicate-name collapse ran after the shortlist was cut, they filled it and
 * then became a single row — "pasta" answered with one food and "peanut butter"
 * with two.
 *
 * One more than `SHORTLIST` in `ranking.ts` is the smallest crowd that
 * reproduces it, and the first id is far enough above the hand-written rows that
 * the two never collide.
 */
const CROWD_SIZE = 501;
const CROWD_FIRST_ID = 1000;

/** The crowd, as rows in the same shape as the ones above. */
function crowd(): FixtureRow[] {
	return Array.from({ length: CROWD_SIZE }, (_unused, index) => ({
		id: CROWD_FIRST_ID + index,
		name: 'PASTA',
		brand: `DRIED GOODS ${index}`,
		kind: 'branded' as const,
		quality: 94,
		sources: 9,
		barcode: null,
		alias: null
	}));
}

const SCHEMA = `
create table food (
	food_id bigint, gtin14 varchar, name varchar, brand varchar, category varchar,
	kind varchar, region varchar, license varchar, serving_label varchar, serving_g double,
	kcal double, protein double, fat double, carbs double, sugar double, fiber double,
	sodium double, saturated_fat double, potassium double, iron double, calcium double,
	magnesium double, zinc double, vitamin_a double, vitamin_c double, vitamin_d double,
	vitamin_b12 double, quality bigint, n_sources bigint
);
create table food_alias (food_id bigint, alias varchar);
create table food_serving (food_id bigint, label varchar, grams double, is_default bigint);
create index idx_serving_food on food_serving (food_id);
create unique index idx_food_id on food (food_id);
create index idx_food_gtin on food (gtin14);
create virtual table food_fts using fts5(
	name, brand, aliases, content='', tokenize='unicode61 remove_diacritics 2');
`;

/** The fixture as an open in-memory catalog, indexed the way the real file is. */
export function createFixtureCatalog(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec(SCHEMA);
	const food = db.prepare(
		`insert into food (food_id, gtin14, name, brand, category, kind, region, license,
			serving_label, serving_g, kcal, protein, fat, carbs, sugar, fiber, sodium,
			saturated_fat, potassium, iron, calcium, magnesium, zinc, vitamin_a, vitamin_c,
			vitamin_d, vitamin_b12, quality, n_sources)
		values (?, ?, ?, ?, 'Test', ?, 'US', 'public-domain', 'serving', 100.0,
			100.0, 5.0, 3.0, 12.0, 4.0, 1.0, 50.0, 1.0,
			150.0, 1.2, 120.0, 15.0, 0.8, 40.0, 5.0, 0.2, 0.6, ?, ?)`
	);
	const alias = db.prepare('insert into food_alias (food_id, alias) values (?, ?)');
	const serving = db.prepare(
		'insert into food_serving (food_id, label, grams, is_default) values (?, ?, ?, 0)'
	);
	const indexed = db.prepare(
		'insert into food_fts (rowid, name, brand, aliases) values (?, ?, ?, ?)'
	);
	for (const row of [...FIXTURE_FOODS, ...crowd()]) {
		food.run(row.id, row.barcode, row.name, row.brand, row.kind, row.quality, row.sources);
		if (row.alias !== null) alias.run(row.id, row.alias);
		for (const [label, grams] of row.servings ?? []) serving.run(row.id, label, grams);
		indexed.run(row.id, row.name, row.brand ?? '', row.alias ?? '');
	}
	return db;
}
