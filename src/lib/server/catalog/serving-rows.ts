import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { ServingRow } from '$lib/domain/default-serving';
import { prepared } from './statements';

/**
 * The `food_serving` rows of a page of foods: real text labels beside real
 * weights, nothing else — the same shape `typeof` already guards a column
 * changing under the ETL from becoming a silent wrong value rather than an
 * absent one.
 */
function servingRowsSql(foods: number): string {
	return `select food_id, label, grams from food_serving
		where food_id in (${Array.from({ length: foods }, () => '?').join(', ')})
			and typeof(label) = 'text' and typeof(grams) in ('real', 'integer')
		order by food_id, is_default desc, label`;
}

/**
 * Every household-measure row of a page of foods, grouped by food.
 *
 * Shared by `default-serving.ts` and `unit-measure.ts`: both ask this exact
 * question of `food_serving` — every row of a page of foods, in the source's
 * own order — and only differ in which row they pick from the answer
 * (`pickDefaultServing` vs `pickUnitMeasure`). `portions.ts` stays its own
 * query rather than joining this one: it parses each row into a volume while
 * grouping, instead of grouping first and choosing afterward.
 */
export function servingRowsByFood(
	catalog: DatabaseSync,
	ids: readonly number[]
): Map<number, ServingRow[]> {
	const byFood = new Map<number, ServingRow[]>();
	if (ids.length === 0) return byFood;
	const rows: Record<string, SQLOutputValue>[] = prepared(catalog, servingRowsSql(ids.length)).all(
		...ids
	);
	for (const row of rows) {
		const id = Number(row['food_id']);
		const entry = { label: String(row['label']), grams: Number(row['grams']) };
		const held = byFood.get(id);
		if (held === undefined) byFood.set(id, [entry]);
		else held.push(entry);
	}
	return byFood;
}
