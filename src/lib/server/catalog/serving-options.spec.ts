import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { servingRowsByFood } from './serving-rows';
import { MAX_GRAMS, withServingOptions } from './serving-options';

/** A catalog holding nothing but the serving rows a case needs. */
function catalogOf(rows: [id: number, label: unknown, grams: unknown, isDefault: number][]) {
	const db = new DatabaseSync(':memory:');
	db.exec(
		`create table food_serving (food_id bigint, label varchar, grams double, is_default bigint);
		create index idx_serving_food on food_serving (food_id);`
	);
	const insert = db.prepare(
		'insert into food_serving (food_id, label, grams, is_default) values (?, ?, ?, ?)'
	);
	for (const [id, label, grams, isDefault] of rows)
		insert.run(id, label as string, grams as number, isDefault);
	return db;
}

type Food = { id: number };

/**
 * The page's serving rows, as `foods.ts` fetches them once and hands them to
 * this module. Read through `servingRowsByFood` rather than built by hand, so
 * these cases still run against the statement the server really asks — the
 * filters and the `is_default desc, label` order they depend on live there.
 */
function rowsFor(db: DatabaseSync, foods: readonly { id: number }[]) {
	return servingRowsByFood(db, [...new Set(foods.map((food) => food.id))]);
}

describe('withServingOptions', () => {
	let db: DatabaseSync;

	beforeEach(() => {
		db = catalogOf([
			// A branded food with a named default and a plain-weight catch-all.
			[1, '4.0 oz', 113, 1],
			[1, '1.0 medium breast', 172, 0],
			[1, '100 g', 100, 0]
		]);
	});

	it('reports a food’s serving rows verbatim, not reinterpreted', () => {
		const foods: Food[] = [{ id: 1 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{
				id: 1,
				servingOptions: [
					{ label: '4.0 oz', grams: 113 },
					{ label: '1.0 medium breast', grams: 172 },
					{ label: '100 g', grams: 100 }
				]
			}
		]);
	});

	it('preserves the catalog’s own order: default first, then label text', () => {
		// `servingRowsByFood` orders `is_default desc, label` — this module must
		// not re-sort what it was handed.
		db.exec(
			`insert into food_serving (food_id, label, grams, is_default) values
				(2, 'b label', 50, 0), (2, 'a label', 60, 0), (2, 'z default', 70, 1)`
		);
		const foods: Food[] = [{ id: 2 }];
		expect(
			withServingOptions(rowsFor(db, foods), foods)[0]?.servingOptions.map((o) => o.label)
		).toEqual(['z default', 'a label', 'b label']);
	});

	it('collapses rows naming the same portion, keeping the first', () => {
		db.exec(
			`insert into food_serving (food_id, label, grams, is_default) values
				(3, '1 Cup', 240, 1), (3, '1 cup', 244, 0), (3, ' 1 CUP ', 250, 0)`
		);
		const foods: Food[] = [{ id: 3 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{ id: 3, servingOptions: [{ label: '1 Cup', grams: 240 }] }
		]);
	});

	it('rejects a row whose weight is not a plausible single serving', () => {
		// The #157/#178 catalog defect: a row claiming a weight orders of
		// magnitude off (here, ten times the cap) rather than a real serving.
		db.exec(
			`insert into food_serving (food_id, label, grams, is_default) values
				(4, '1 tsp', 100000, 0), (4, '1 tbsp', 15, 0)`
		);
		const foods: Food[] = [{ id: 4 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{ id: 4, servingOptions: [{ label: '1 tbsp', grams: 15 }] }
		]);
	});

	it('rejects a zero, negative, or non-finite weight', () => {
		db.exec(
			`insert into food_serving (food_id, label, grams, is_default) values
				(5, 'zero', 0, 0), (5, 'negative', -10, 0), (5, 'real one', 30, 0)`
		);
		const foods: Food[] = [{ id: 5 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{ id: 5, servingOptions: [{ label: 'real one', grams: 30 }] }
		]);
	});

	it('keeps a row at exactly MAX_GRAMS, and drops one a hair past it', () => {
		// The #157/#178 catalog defect check above uses a weight ten times the
		// cap, which says nothing about which side of the cap the boundary
		// itself falls on — a `<=` weakened to `<` would still pass it while
		// quietly rejecting the heaviest real serving the catalog can report.
		db.exec(
			`insert into food_serving (food_id, label, grams, is_default) values
				(7, 'at the cap', ${MAX_GRAMS}, 0), (7, 'past the cap', ${MAX_GRAMS + 1}, 0)`
		);
		const foods: Food[] = [{ id: 7 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{ id: 7, servingOptions: [{ label: 'at the cap', grams: MAX_GRAMS }] }
		]);
	});

	it('dedupes on a fold that goes toward lowercase, not toward uppercase', () => {
		// Case-folding is not symmetric for every letter: the German ß
		// lowercases to itself but uppercases to "SS", so a label spelled with
		// it and a label already spelled "SS" agree once folded uppercase but
		// disagree once folded lowercase. The catalog's own choice of
		// direction is what a label like "1 Straße" and one already written
		// "1 STRASSE" must be tested against, or a fold running the other way
		// would still pass every same-case-pair fixture above.
		db.exec(
			`insert into food_serving (food_id, label, grams, is_default) values
				(8, '1 Straße', 100, 1), (8, '1 STRASSE', 105, 0)`
		);
		const foods: Food[] = [{ id: 8 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{
				id: 8,
				servingOptions: [
					{ label: '1 Straße', grams: 100 },
					{ label: '1 STRASSE', grams: 105 }
				]
			}
		]);
	});

	it('caps the options returned per food', () => {
		for (let i = 0; i < 15; i += 1)
			db.exec(
				`insert into food_serving (food_id, label, grams, is_default) values
					(6, 'label ${i}', ${10 + i}, 0)`
			);
		const foods: Food[] = [{ id: 6 }];
		expect(withServingOptions(rowsFor(db, foods), foods)[0]?.servingOptions).toHaveLength(10);
	});

	it('answers an empty list for a food with no serving rows at all', () => {
		const foods: Food[] = [{ id: 999 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{ id: 999, servingOptions: [] }
		]);
	});

	it('answers nothing for an empty page of foods', () => {
		expect(withServingOptions(rowsFor(db, []), [])).toEqual([]);
	});

	it('answers every food asked about, including one with no rows', () => {
		const foods: Food[] = [{ id: 1 }, { id: 999 }];
		expect(withServingOptions(rowsFor(db, foods), foods)).toEqual([
			{
				id: 1,
				servingOptions: [
					{ label: '4.0 oz', grams: 113 },
					{ label: '1.0 medium breast', grams: 172 },
					{ label: '100 g', grams: 100 }
				]
			},
			{ id: 999, servingOptions: [] }
		]);
	});
});
