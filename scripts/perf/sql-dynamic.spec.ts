import { describe, expect, it } from 'vitest';
import * as foods from '../../src/lib/server/catalog/foods.ts';
import * as servingRows from '../../src/lib/server/catalog/serving-rows.ts';
import {
	DYNAMIC_PROBES,
	captureDynamicStatements,
	captureProbe,
	recordingConnection
} from './sql-dynamic.ts';
import type { Loaded } from './sql-dynamic.ts';

/**
 * The probes run against the real catalog modules, imported the way vitest
 * already resolves `$lib`. That is the point of the specs below: a probe that
 * has drifted from the call site it names has to fail here rather than quietly
 * record the wrong statement, or nothing.
 */
const MODULES: Record<string, Loaded> = {
	'src/lib/server/catalog/foods.ts': foods,
	'src/lib/server/catalog/serving-rows.ts': servingRows
};

const load = (file: string): Promise<Loaded> => {
	const loaded = MODULES[file];
	if (loaded === undefined) throw new Error(`No module stubbed for ${file}.`);
	return Promise.resolve(loaded);
};

describe('recordingConnection', () => {
	it('records the SQL handed to prepare and executes nothing', () => {
		const recorder = recordingConnection();
		const statement = recorder.db.prepare('select 1') as { all: () => unknown[] };
		expect(statement.all()).toEqual([]);
		expect(recorder.recorded).toEqual(['select 1']);
	});
});

describe('captureProbe', () => {
	it('refuses a call site that prepared nothing', () => {
		const probe = { file: 'a.ts', label: 'never', run: () => undefined };
		expect(() => captureProbe(probe, {}, 20)).toThrow('prepared 0 statements');
	});

	it('refuses a call site that prepared more than one statement', () => {
		const probe = {
			file: 'a.ts',
			label: 'twice',
			run: (_loaded: Loaded, db: { prepare(sql: string): unknown }) => {
				db.prepare('select 1');
				db.prepare('select 2');
			}
		};
		expect(() => captureProbe(probe, {}, 20)).toThrow('prepared 2 statements');
	});

	it('names the export when a probe points at a function that is gone', () => {
		expect(DYNAMIC_PROBES.length).toBeGreaterThan(0);
		for (const probe of DYNAMIC_PROBES) {
			expect(() => captureProbe(probe, {}, 20)).toThrow('is not an exported function');
		}
	});
});

describe('captureDynamicStatements', () => {
	it('records one statement for every function-built call site', async () => {
		const captured = await captureDynamicStatements('.', load);
		expect(captured.map((each) => `${each.file} ${each.label}`)).toEqual([
			'src/lib/server/catalog/foods.ts rankedPage',
			'src/lib/server/catalog/serving-rows.ts servingRowsByFood'
		]);
	});

	it('captures the ranked search itself, not a paraphrase of it', async () => {
		const [search] = await captureDynamicStatements('.', load);
		expect(search?.sql).toContain('food_fts match :match');
		expect(search?.sql).toContain('limit :limit');
	});

	it('binds one placeholder per food of a default page on the serving read', async () => {
		const captured = await captureDynamicStatements('.', load);
		const page = foods.pageSize(null);
		const statement = captured.find((each) => each.label === 'servingRowsByFood');
		expect(statement?.sql).toContain('from food_serving');
		expect(statement?.sql.match(/\?/g)).toHaveLength(page);
	});

	it('takes its page size from the module that owns it', async () => {
		const withPage = { ...foods, pageSize: () => 3 } as unknown as Loaded;
		const captured = await captureDynamicStatements('.', (file) =>
			file === 'src/lib/server/catalog/foods.ts' ? Promise.resolve(withPage) : load(file)
		);
		const statement = captured.find((each) => each.label === 'servingRowsByFood');
		expect(statement?.sql.match(/\?/g)).toHaveLength(3);
	});
});
