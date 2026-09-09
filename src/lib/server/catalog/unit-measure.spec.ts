import { DatabaseSync } from 'node:sqlite';
import * as unitMeasureDomain from '$lib/domain/unit-measure';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { servingRowsByFood } from './serving-rows';
import { withUnitMeasure } from './unit-measure';

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

describe('withUnitMeasure', () => {
	let db: DatabaseSync;

	beforeEach(() => {
		db = catalogOf([
			// SR Legacy's Big Mac: a real single-item measure beside the catch-all.
			[1, '1.0 item 7.6 oz', 219, 0],
			[1, '100 g', 100, 0],
			// The popcorn-chicken trap: pieces-per-serving, not one piece's weight.
			[2, '13 PIECE', 100, 0],
			[2, '100 g', 100, 0],
			// A real single-piece measure.
			[3, '1 Piece', 105, 0],
			// Only the guaranteed catch-all, and a volume unit that is not countable.
			[4, '100 g', 100, 0],
			[4, '1 cup', 240, 0]
		]);
	});

	it('carries the usable unit measure for a food with a genuine single-item row', () => {
		const foods: Food[] = [{ id: 1 }];
		expect(withUnitMeasure(rowsFor(db, foods), foods)).toEqual([
			{ id: 1, unit: { label: '1.0 item 7.6 oz', grams: 219 } }
		]);
	});

	it('answers null for a food whose only piece label is a per-serving count', () => {
		const foods: Food[] = [{ id: 2 }];
		expect(withUnitMeasure(rowsFor(db, foods), foods)).toEqual([{ id: 2, unit: null }]);
	});

	it('carries a plain single-piece measure', () => {
		const foods: Food[] = [{ id: 3 }];
		expect(withUnitMeasure(rowsFor(db, foods), foods)).toEqual([
			{ id: 3, unit: { label: '1 Piece', grams: 105 } }
		]);
	});

	it('answers null for a food with only weight and volume rows', () => {
		const foods: Food[] = [{ id: 4 }];
		expect(withUnitMeasure(rowsFor(db, foods), foods)).toEqual([{ id: 4, unit: null }]);
	});

	it('answers null for a food with no food_serving rows at all', () => {
		const foods: Food[] = [{ id: 999 }];
		expect(withUnitMeasure(rowsFor(db, foods), foods)).toEqual([{ id: 999, unit: null }]);
	});

	it('answers nothing for an empty page of foods', () => {
		expect(withUnitMeasure(rowsFor(db, []), [])).toEqual([]);
	});

	it('carries every row of a food forward, not only the first the query returns', () => {
		// "0 Piece" sorts alphabetically before "1 Piece", so the query returns
		// it first. It is not a usable unit itself (no leading "1"), so the
		// picker only finds "1 Piece" if the second row was actually collected
		// against food 5 rather than only the first one seen.
		db.exec(
			`insert into food_serving (food_id, label, grams, is_default) values
				(5, '0 Piece', 50, 0), (5, '1 Piece', 105, 0)`
		);
		const foods: Food[] = [{ id: 5 }];
		expect(withUnitMeasure(rowsFor(db, foods), foods)).toEqual([
			{ id: 5, unit: { label: '1 Piece', grams: 105 } }
		]);
	});

	it('asks the picker with a real empty array, not a non-empty placeholder, for a food with no rows', () => {
		const spy = vi.spyOn(unitMeasureDomain, 'pickUnitMeasure');
		const missing: Food[] = [{ id: 999 }];
		withUnitMeasure(rowsFor(db, missing), missing);
		expect(spy).toHaveBeenCalledWith([]);
		spy.mockRestore();
	});

	it('answers for every food asked about, including one with no rows at all', () => {
		const foods: Food[] = [{ id: 1 }, { id: 999 }];
		expect(withUnitMeasure(rowsFor(db, foods), foods)).toEqual([
			{ id: 1, unit: { label: '1.0 item 7.6 oz', grams: 219 } },
			{ id: 999, unit: null }
		]);
	});
});
