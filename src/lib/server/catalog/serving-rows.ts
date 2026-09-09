import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { ServingRow } from '$lib/domain/default-serving';
import { prepared } from './statements';

/**
 * The `food_serving` rows of a page of foods: real text labels beside real
 * weights, nothing else — the same shape `typeof` already guards a column
 * changing under the ETL from becoming a silent wrong value rather than an
 * absent one. `typeof` refuses the changed column here rather than in
 * TypeScript for the reason `foods.ts` gives about the ETL owning this file: a
 * row whose label arrived as a blob is one row to leave out, not a reason to
 * fail the search that found the food. Filtering in the query is what lets
 * every reader below be exact rather than a coercion.
 *
 * One statement for the page rather than a point lookup per food. The lookup
 * was cheap — `idx_serving_food` is an index seek — but it was paid twenty
 * times for a twenty-food page, and each of those crosses into SQLite and
 * builds its own result set. Measured on the 1.4 GB catalog, warm, over eight
 * queries at the default page size: p50 0.303 ms per page one row at a time
 * against 0.135 ms in one statement.
 *
 * The order is what decides between two rows naming the same unit — a food
 * with both `1 Tbsp` and `2 Tbsp` — so it is stated rather than left to the
 * table's insertion order: the label the food itself is served by wins, and
 * ties break on the label text so the same catalog always answers the same
 * way. `food_id` leads it so that the rows of one food arrive together and a
 * grouping pass over the result is a single pass.
 *
 * The bound list is one parameter per food, which `pageSize` caps at fifty and
 * a barcode's duplicate rows never approach — far below SQLite's variable
 * limit, so there is no batching to do.
 *
 * Exported because `portions.ts` reads the same rows to a different end and
 * used to build this string a second time, byte for byte. Two copies of the
 * text are two copies of the `order by` that decides which row wins, and
 * `quality/perf-plans.md` recorded the statement twice to prove it; one
 * definition is what stops a filter or a tie-break being changed for one
 * reader and not the other.
 */
export function servingRowsSql(foods: number): string {
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
 * (`pickDefaultServing` vs `pickUnitMeasure`). `serving-options.ts` reads the
 * same map and keeps every row instead of picking one. `portions.ts` keeps its
 * own grouping pass rather than calling this — it parses each row into a volume
 * while grouping, instead of grouping first and choosing afterward — but it
 * runs `servingRowsSql` above, not a second statement of its own.
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
