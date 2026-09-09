import { DatabaseSync } from 'node:sqlite';
import * as defaultServingDomain from '$lib/domain/default-serving';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withDefaultServing } from './default-serving';
import { servingRowsByFood } from './serving-rows';

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

type Food = { id: number; serving: { label: string | null; grams: number | null } };

/**
 * The page's serving rows, as `foods.ts` fetches them once and hands them to
 * this module. Read through `servingRowsByFood` rather than built by hand, so
 * these cases still run against the statement the server really asks — the
 * filters and the `is_default desc, label` order the picks below depend on.
 */
function rowsFor(db: DatabaseSync, foods: readonly { id: number }[]) {
	return servingRowsByFood(db, [...new Set(foods.map((food) => food.id))]);
}

describe('withDefaultServing', () => {
	let db: DatabaseSync;

	beforeEach(() => {
		db = catalogOf([
			// SR Legacy's Big Mac: a real household measure beside the catch-all.
			[1, '1.0 item 7.6 oz', 219, 0],
			[1, '100 g', 100, 0],
			// A food with only numeric FNDDS portion codes, no whole-item wording.
			[2, '60190', 205, 0],
			[2, '64742', 135, 0],
			[2, '100 g', 100, 0],
			// A food with no measure beyond the guaranteed catch-all.
			[3, '100 g', 100, 0]
		]);
	});

	it('prefers a whole-item measure for a food with no serving of its own', () => {
		const foods: Food[] = [{ id: 1, serving: { label: null, grams: null } }];
		expect(withDefaultServing(rowsFor(db, foods), foods)).toEqual([
			{ id: 1, serving: { label: '1.0 item 7.6 oz', grams: 219 } }
		]);
	});

	it('falls back to the first household measure when no whole-item measure names itself', () => {
		const foods: Food[] = [{ id: 2, serving: { label: null, grams: null } }];
		expect(withDefaultServing(rowsFor(db, foods), foods)).toEqual([
			{ id: 2, serving: { label: '60190', grams: 205 } }
		]);
	});

	it('falls back to an explicit "per 100 g" when only the catch-all row exists', () => {
		const foods: Food[] = [{ id: 3, serving: { label: null, grams: null } }];
		expect(withDefaultServing(rowsFor(db, foods), foods)).toEqual([
			{ id: 3, serving: { label: 'per 100 g', grams: null } }
		]);
	});

	it('falls back to "per 100 g" for a food with no food_serving rows at all', () => {
		const foods: Food[] = [{ id: 999, serving: { label: null, grams: null } }];
		expect(withDefaultServing(rowsFor(db, foods), foods)).toEqual([
			{ id: 999, serving: { label: 'per 100 g', grams: null } }
		]);
	});

	it('leaves a food that already names its own serving untouched', () => {
		const foods: Food[] = [{ id: 1, serving: { label: '1 PACKET', grams: 32 } }];
		expect(withDefaultServing(rowsFor(db, foods), foods)).toEqual([
			{ id: 1, serving: { label: '1 PACKET', grams: 32 } }
		]);
	});

	it('asks the picker with a real empty array, not a non-empty placeholder, for a food with no rows', () => {
		// Guards the `?? []` fallback itself: a food_id absent from the grouped
		// map must reach `pickDefaultServing` with an actually empty array, not
		// some non-empty stand-in that happens to filter down to the same
		// answer.
		const spy = vi.spyOn(defaultServingDomain, 'pickDefaultServing');
		const missing: Food[] = [{ id: 999, serving: { label: null, grams: null } }];
		withDefaultServing(rowsFor(db, missing), missing);
		expect(spy).toHaveBeenCalledWith([]);
		spy.mockRestore();
	});

	it('answers for every food asked about, including one with no rows at all', () => {
		const foods: Food[] = [
			{ id: 1, serving: { label: null, grams: null } },
			{ id: 999, serving: { label: null, grams: null } }
		];
		expect(withDefaultServing(rowsFor(db, foods), foods)).toEqual([
			{ id: 1, serving: { label: '1.0 item 7.6 oz', grams: 219 } },
			{ id: 999, serving: { label: 'per 100 g', grams: null } }
		]);
	});
});
