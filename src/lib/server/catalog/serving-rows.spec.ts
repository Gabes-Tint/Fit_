import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withPortions } from './portions';
import { servingRowsByFood, servingRowsSql } from './serving-rows';

/**
 * `food_serving` has four readers — `default-serving.ts`, `unit-measure.ts`,
 * `serving-options.ts` and `portions.ts` — and all four have to see the same
 * rows in the same order, because the order is what picks the winning row and
 * the `typeof` filter is what keeps a corrupted one out. `portions.ts` used to
 * build a byte-identical copy of this statement instead of running this one,
 * which meant a filter or a tie-break could be changed for three readers and
 * not the fourth. These cases fail if that copy comes back.
 */

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

/** The SQL each reader hands to `prepare`, with nothing executed. */
function recorded(read: (db: DatabaseSync) => void): string[] {
	const statements: string[] = [];
	const catalog = {
		prepare: (sql: string) => {
			statements.push(sql);
			return { all: () => [] };
		}
	};
	read(catalog as unknown as DatabaseSync);
	return statements;
}

let db: DatabaseSync;

beforeEach(() => {
	db = catalogOf([
		// Two rows name the same unit and disagree about what one of it weighs,
		// and the food's own serving is the one that sorts *last* by label. So
		// a reader that dropped `is_default desc` and fell back to the label
		// answers 13.5 g per tablespoon where this catalog says 20.
		[1, '1 Tbsp', 13.5, 0],
		[1, '2 Tbsp', 40, 1],
		// A label the ETL wrote as a blob rather than as text: the shape
		// `typeof(label)` exists to leave out. It parses as a cup, so a reader
		// that dropped the filter would answer with one.
		[1, Buffer.from('1 cup'), 240, 0]
	]);
});

afterEach(() => {
	db.close();
});

describe('servingRowsSql', () => {
	it('is the statement `portions.ts` runs, so one order-by serves both readers', () => {
		expect(recorded((catalog) => servingRowsByFood(catalog, [1, 2]))).toEqual(
			recorded((catalog) => withPortions(catalog, [{ id: 1 }, { id: 2 }]))
		);
	});

	it('binds one placeholder per food asked about', () => {
		expect(servingRowsSql(3)).toContain('food_id in (?, ?, ?)');
	});
});

describe('the rows every reader sees', () => {
	it('leaves out a row whose label or weight arrived in the wrong shape', () => {
		expect(servingRowsByFood(db, [1]).get(1)).toEqual([
			{ label: '2 Tbsp', grams: 40 },
			{ label: '1 Tbsp', grams: 13.5 }
		]);
	});

	it('gives `portions.ts` the food’s own serving first, not the table’s order', () => {
		// The same fact as the case above, read from the other side: the row
		// this module reports first is the row `portions.ts` scales by. 20 g is
		// `2 Tbsp` at 40 g halved; 13.5 would be the row the label sorts first.
		const [portions] = withPortions(db, [{ id: 1 }]);
		expect(portions?.portions).toEqual([{ unit: 'tbsp', grams: 20 }]);
	});

	it('sets no entry at all for a food with no usable rows', () => {
		expect(servingRowsByFood(db, [1, 2]).has(2)).toBe(false);
	});
});
