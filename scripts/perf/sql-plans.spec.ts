import { describe, expect, it } from 'vitest';
import { formatPlans } from './sql-plans';
import type { PlanResult } from './sql-plans';

describe('formatPlans', () => {
	it('names the fixture schema when no live catalog is installed', () => {
		const result: PlanResult = { catalogSource: 'fixture', plans: [], unresolved: [] };
		const text = formatPlans(result);
		expect(text).toContain('in-memory fixture schema');
	});

	it('names the live catalog when one was opened', () => {
		const result: PlanResult = { catalogSource: 'live', plans: [], unresolved: [] };
		expect(formatPlans(result)).toContain('live catalog file');
	});

	it('renders a section per statement with its SQL and every plan row', () => {
		const result: PlanResult = {
			catalogSource: 'fixture',
			plans: [
				{
					file: 'src/lib/server/users/sessions.ts',
					label: 'startSession',
					sql: 'insert into session (id) values (?)',
					source: 'literal',
					rows: [
						{ id: 0, parent: 0, unused: 0, detail: 'SCAN session' },
						{ id: 0, parent: 0, unused: 0, detail: 'USE TEMP B-TREE' }
					]
				}
			],
			unresolved: []
		};
		const text = formatPlans(result);
		expect(text).toContain('### src/lib/server/users/sessions.ts — startSession');
		expect(text).toContain('insert into session (id) values (?)');
		expect(text).toContain('- SCAN session');
		expect(text).toContain('- USE TEMP B-TREE');
	});

	it('marks a statement recorded from the running code, so its provenance is in the diff', () => {
		const text = formatPlans({
			catalogSource: 'fixture',
			plans: [
				{
					file: 'src/lib/server/catalog/foods.ts',
					label: 'searchFoods',
					sql: 'select 1',
					source: 'captured',
					rows: [{ id: 0, parent: 0, unused: 0, detail: 'SCAN food' }]
				}
			],
			unresolved: []
		});
		expect(text).toContain('### src/lib/server/catalog/foods.ts — searchFoods (built at run time)');
	});

	it('lists call sites the parser could not resolve, under their own heading', () => {
		const result: PlanResult = {
			catalogSource: 'fixture',
			plans: [],
			unresolved: [
				{
					file: 'src/lib/server/catalog/foods.ts',
					label: 'searchFoods',
					snippet: 'searchSql(FOOD_COLUMNS)'
				}
			]
		};
		const text = formatPlans(result);
		expect(text).toContain('## Not extracted');
		expect(text).toContain(
			'src/lib/server/catalog/foods.ts — searchFoods: `searchSql(FOOD_COLUMNS)`'
		);
	});

	it('omits the "Not extracted" section when every statement resolved', () => {
		const text = formatPlans({ catalogSource: 'fixture', plans: [], unresolved: [] });
		expect(text).not.toContain('Not extracted');
	});
});
