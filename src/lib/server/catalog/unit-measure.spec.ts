import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import * as unitMeasureDomain from '$lib/domain/unit-measure';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
		expect(withUnitMeasure(db, foods)).toEqual([
			{ id: 1, unit: { label: '1.0 item 7.6 oz', grams: 219 } }
		]);
	});

	it('answers null for a food whose only piece label is a per-serving count', () => {
		const foods: Food[] = [{ id: 2 }];
		expect(withUnitMeasure(db, foods)).toEqual([{ id: 2, unit: null }]);
	});

	it('carries a plain single-piece measure', () => {
		const foods: Food[] = [{ id: 3 }];
		expect(withUnitMeasure(db, foods)).toEqual([{ id: 3, unit: { label: '1 Piece', grams: 105 } }]);
	});

	it('answers null for a food with only weight and volume rows', () => {
		const foods: Food[] = [{ id: 4 }];
		expect(withUnitMeasure(db, foods)).toEqual([{ id: 4, unit: null }]);
	});

	it('answers null for a food with no food_serving rows at all', () => {
		const foods: Food[] = [{ id: 999 }];
		expect(withUnitMeasure(db, foods)).toEqual([{ id: 999, unit: null }]);
	});

	it('asks the catalog nothing for an empty page of foods', () => {
		const counted = { reads: 0 };
		const catalog = {
			prepare: (sql: string) => {
				const statement = db.prepare(sql);
				return {
					all: (...values: SQLInputValue[]) => ((counted.reads += 1), statement.all(...values))
				};
			}
		} as unknown as DatabaseSync;
		expect(withUnitMeasure(catalog, [])).toEqual([]);
		expect(counted.reads).toBe(0);
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
		expect(withUnitMeasure(db, foods)).toEqual([{ id: 5, unit: { label: '1 Piece', grams: 105 } }]);
	});

	it('answers every food on the page in one statement rather than one per food', () => {
		const counted = { reads: 0 };
		const catalog = {
			prepare: (sql: string) => {
				const statement = db.prepare(sql);
				return {
					all: (...values: SQLInputValue[]) => ((counted.reads += 1), statement.all(...values))
				};
			}
		} as unknown as DatabaseSync;
		const foods: Food[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
		withUnitMeasure(catalog, foods);
		expect(counted.reads).toBe(1);
	});

	it('asks the picker with a real empty array, not a non-empty placeholder, for a food with no rows', () => {
		const spy = vi.spyOn(unitMeasureDomain, 'pickUnitMeasure');
		withUnitMeasure(db, [{ id: 999 }]);
		expect(spy).toHaveBeenCalledWith([]);
		spy.mockRestore();
	});

	it('answers for every food asked about, including one with no rows at all', () => {
		const foods: Food[] = [{ id: 1 }, { id: 999 }];
		expect(withUnitMeasure(db, foods)).toEqual([
			{ id: 1, unit: { label: '1.0 item 7.6 oz', grams: 219 } },
			{ id: 999, unit: null }
		]);
	});
});
