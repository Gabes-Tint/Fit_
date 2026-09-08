import { describe, expect, it } from 'vitest';
import {
	areaOf,
	classify,
	isMutated,
	isSourceFile,
	ledgerFailures,
	ledgerShapeFailures,
	LEDGER_PATH,
	renderLedger,
	sourceFiles,
	SOURCE_ROOTS,
	UNCOVERED_AREAS,
	type UncoveredLedger
} from './mutation-scope-ledger';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

/** A ledger with every area present and empty, so a test states only what it adds. */
function ledgerOf(areas: Record<string, string[]>): UncoveredLedger {
	return {
		version: 1,
		areas: Object.fromEntries(UNCOVERED_AREAS.map(({ id }) => [id, areas[id] ?? []]))
	};
}

describe('isSourceFile', () => {
	it('accepts the executable extensions, including ones the tree does not use yet', () => {
		for (const file of [
			'scripts/deploy/deploy.ts',
			'src/lib/components/AppShell.svelte',
			'scripts/tool.mjs',
			'scripts/tool.cjs',
			'scripts/tool.js',
			'scripts/tool.mts',
			'scripts/tool.cts'
		]) {
			expect(isSourceFile(file), file).toBe(true);
		}
	});

	it('rejects declarations, tests and anything that is not code', () => {
		for (const file of [
			'src/lib/types.d.ts',
			'src/lib/domain/tdee.spec.ts',
			'scripts/quality/gate.test.ts',
			'src/routes/you.e2e.ts',
			'src/app.css',
			'src/app.html',
			'scripts/deploy/fit.service',
			'tests/fixtures/plate.jpg'
		]) {
			expect(isSourceFile(file), file).toBe(false);
		}
	});
});

describe('isMutated', () => {
	it('is true for production TypeScript under src/ that no exclusion removes', () => {
		expect(isMutated('src/lib/domain/tdee.ts')).toBe(true);
		expect(isMutated('src/lib/server/users/session.ts')).toBe(true);
		// Every lane hands Stryker a file list built by walking all of `src`, so a
		// route handler is mutated even though the default glob says `src/lib/**`.
		expect(isMutated('src/routes/api/sessions/+server.ts')).toBe(true);
	});

	it('is false for a file an exclusion in quality/mutate-patterns.mjs removes', () => {
		expect(isMutated('src/lib/domain/seed-foods.ts')).toBe(false);
		expect(isMutated('src/lib/ui/camera.ts')).toBe(false);
		expect(isMutated('src/routes/+layout.ts')).toBe(false);
	});

	it('is false for components, tests and anything outside src/', () => {
		expect(isMutated('src/lib/components/AppShell.svelte')).toBe(false);
		expect(isMutated('src/lib/domain/tdee.spec.ts')).toBe(false);
		expect(isMutated('scripts/deploy/deploy.ts')).toBe(false);
		expect(isMutated('tests/preview-server.ts')).toBe(false);
	});
});

describe('areaOf', () => {
	it('names the area for each kind of file outside the lanes', () => {
		expect(areaOf('src/lib/version.ts')).toBe('excluded-by-pattern');
		expect(areaOf('src/lib/components/AppShell.svelte')).toBe('library-components');
		expect(areaOf('src/routes/you/+page.svelte')).toBe('route-components');
		expect(areaOf('scripts/deploy/deploy.ts')).toBe('tooling-scripts');
		expect(areaOf('tests/preview-server.ts')).toBe('e2e-harness');
	});

	it('is null for a file no area claims', () => {
		expect(areaOf('capacitor.config.ts')).toBeNull();
	});

	it('gives every area a distinct id', () => {
		expect(new Set(UNCOVERED_AREAS.map(({ id }) => id)).size).toBe(UNCOVERED_AREAS.length);
	});

	it('makes every area say what covers it instead', () => {
		for (const area of UNCOVERED_AREAS) {
			expect(area.coveredBy.length, area.id).toBeGreaterThan(0);
			expect(area.holds.length, area.id).toBeGreaterThan(0);
		}
	});
});

describe('classify', () => {
	it('drops mutated files and test files, and sorts what is left into areas', () => {
		const { byArea, unclaimed } = classify([
			'src/lib/domain/tdee.ts',
			'src/lib/domain/tdee.spec.ts',
			'src/lib/components/Zebra.svelte',
			'src/lib/components/AppShell.svelte',
			'src/routes/you/+page.svelte',
			'scripts/deploy/deploy.ts',
			'tests/preview-server.ts',
			'src/lib/version.ts'
		]);
		expect(unclaimed).toEqual([]);
		expect(byArea.get('library-components')).toEqual([
			'src/lib/components/AppShell.svelte',
			'src/lib/components/Zebra.svelte'
		]);
		expect(byArea.get('excluded-by-pattern')).toEqual(['src/lib/version.ts']);
		expect(byArea.get('route-components')).toEqual(['src/routes/you/+page.svelte']);
		expect(byArea.get('tooling-scripts')).toEqual(['scripts/deploy/deploy.ts']);
		expect(byArea.get('e2e-harness')).toEqual(['tests/preview-server.ts']);
	});

	it('reports a source file no area claims rather than dropping it', () => {
		expect(classify(['vitest-setup-client-node.ts']).unclaimed).toEqual([
			'vitest-setup-client-node.ts'
		]);
	});

	it('leaves an area empty rather than absent when nothing matches it', () => {
		const { byArea } = classify([]);
		for (const { id } of UNCOVERED_AREAS) expect(byArea.get(id), id).toEqual([]);
	});
});

describe('ledgerShapeFailures', () => {
	it('accepts the shape the writer produces', () => {
		expect(ledgerShapeFailures(ledgerOf({}))).toEqual([]);
	});

	it.each([
		['a JSON array', []],
		['a string', 'areas'],
		['null', null]
	])('rejects %s in place of an object', (_label, value) => {
		expect(ledgerShapeFailures(value)).toEqual([`${LEDGER_PATH} must be a JSON object.`]);
	});

	it('rejects a version it does not know how to read', () => {
		expect(ledgerShapeFailures({ ...ledgerOf({}), version: 2 })).toContain(
			`${LEDGER_PATH} must declare "version": 1.`
		);
	});

	it('rejects a missing or non-object areas map', () => {
		expect(ledgerShapeFailures({ version: 1 })).toContain(
			`${LEDGER_PATH} must have an "areas" object.`
		);
		expect(ledgerShapeFailures({ version: 1, areas: [] })).toContain(
			`${LEDGER_PATH} must have an "areas" object.`
		);
	});

	it('rejects an area name it does not recognize', () => {
		expect(ledgerShapeFailures({ version: 1, areas: { android: [] } }).join('\n')).toContain(
			'has an unknown area "android"'
		);
	});

	it('rejects entries that are not an array of paths', () => {
		expect(
			ledgerShapeFailures({ version: 1, areas: { 'tooling-scripts': 'scripts/x.ts' } }).join('\n')
		).toContain('area "tooling-scripts" must be an array of paths');
		expect(
			ledgerShapeFailures({ version: 1, areas: { 'tooling-scripts': [7] } }).join('\n')
		).toContain('area "tooling-scripts" must be an array of paths');
	});

	it('rejects an unsorted area, so an added file is one line of diff', () => {
		expect(
			ledgerShapeFailures(ledgerOf({ 'tooling-scripts': ['scripts/b.ts', 'scripts/a.ts'] })).join(
				'\n'
			)
		).toContain('area "tooling-scripts" must be sorted');
	});

	it('rejects a duplicated path', () => {
		expect(
			ledgerShapeFailures(ledgerOf({ 'tooling-scripts': ['scripts/a.ts', 'scripts/a.ts'] })).join(
				'\n'
			)
		).toContain('lists the same path twice');
	});

	it('rejects a ledger missing an area entirely', () => {
		expect(ledgerShapeFailures({ version: 1, areas: {} }).join('\n')).toContain(
			`is missing area "library-components"`
		);
	});
});

describe('ledgerFailures', () => {
	const tree = [
		'src/lib/domain/tdee.ts',
		'src/lib/components/AppShell.svelte',
		'scripts/deploy/deploy.ts'
	];
	const recorded = ledgerOf({
		'library-components': ['src/lib/components/AppShell.svelte'],
		'tooling-scripts': ['scripts/deploy/deploy.ts']
	});

	it('passes when the ledger matches the tree exactly', () => {
		expect(ledgerFailures(recorded, tree)).toEqual([]);
	});

	it('fails on a new file in an uncovered area, and says what covers that area', () => {
		const failures = ledgerFailures(recorded, [...tree, 'src/lib/components/Zebra.svelte']);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('src/lib/components/Zebra.svelte');
		expect(failures[0]).toContain('is not on the ledger under "library-components"');
		expect(failures[0]).toContain('component specs in the vitest browser project');
	});

	it('fails on a recorded file that no longer exists', () => {
		const failures = ledgerFailures(recorded, [
			'src/lib/domain/tdee.ts',
			'src/lib/components/AppShell.svelte'
		]);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('scripts/deploy/deploy.ts');
		expect(failures[0]).toContain('gone or a mutation lane reaches it now');
	});

	it('fails on a recorded file a mutation lane reaches now', () => {
		const failures = ledgerFailures(
			ledgerOf({ 'excluded-by-pattern': ['src/lib/domain/tdee.ts'] }),
			['src/lib/domain/tdee.ts']
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('gone or a mutation lane reaches it now');
	});

	it('fails when a file is recorded under the wrong area', () => {
		const failures = ledgerFailures(
			ledgerOf({ 'tooling-scripts': ['src/lib/components/AppShell.svelte'] }),
			['src/lib/components/AppShell.svelte']
		);
		expect(failures.join('\n')).toContain('is not on the ledger under "library-components"');
		expect(failures.join('\n')).toContain('lists src/lib/components/AppShell.svelte');
	});

	it('fails on a source file no area claims', () => {
		const failures = ledgerFailures(ledgerOf({}), ['vitest-setup-client-node.ts']);
		expect(failures.join('\n')).toContain('no ledger area claims it');
	});

	it('reports a broken shape and stops, rather than comparing against nonsense', () => {
		expect(ledgerFailures({ version: 9, areas: {} }, tree)).toEqual([
			`${LEDGER_PATH} must declare "version": 1.`,
			...UNCOVERED_AREAS.map(
				({ id }) => `${LEDGER_PATH} is missing area "${id}"; record it, empty if it has no files.`
			)
		]);
	});

	it('tolerates an area the ledger omits only by reporting it once, not by crashing', () => {
		const partial = { version: 1, areas: { 'library-components': [] } } as UncoveredLedger;
		expect(ledgerFailures(partial, []).length).toBe(UNCOVERED_AREAS.length - 1);
	});
});

describe('renderLedger', () => {
	it('writes every area, sorted, as tab-indented JSON with a trailing newline', () => {
		const rendered = renderLedger([
			'src/lib/components/Zebra.svelte',
			'src/lib/components/AppShell.svelte',
			'src/lib/domain/tdee.ts'
		]);
		expect(rendered.endsWith('\n')).toBe(true);
		expect(rendered).toContain('\n\t"version": 1,');
		const parsed = JSON.parse(rendered) as UncoveredLedger;
		expect(Object.keys(parsed.areas)).toEqual(UNCOVERED_AREAS.map(({ id }) => id));
		expect(parsed.areas['library-components']).toEqual([
			'src/lib/components/AppShell.svelte',
			'src/lib/components/Zebra.svelte'
		]);
		expect(parsed.areas['tooling-scripts']).toEqual([]);
	});

	it('round-trips: what it writes is what the check accepts', () => {
		const tree = ['src/lib/components/AppShell.svelte', 'scripts/deploy/deploy.ts'];
		const written = JSON.parse(renderLedger(tree)) as UncoveredLedger;
		expect(ledgerFailures(written, tree)).toEqual([]);
	});
});

describe('sourceFiles', () => {
	it('walks the recorded roots and returns sorted repository-relative paths', async () => {
		const files = await sourceFiles(projectRoot);
		expect(files).toEqual([...files].sort());
		expect(files).toContain('scripts/quality/mutation-scope-ledger.ts');
		expect(files).toContain('src/lib/components/AppShell.svelte');
		expect(files.every((file) => SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`)))).toBe(
			true
		);
		expect(files).not.toContain('scripts/quality/mutation-scope-ledger.spec.ts');
	});
});

describe('the committed ledger', () => {
	it('is exact against this working tree', async () => {
		const ledger = (await import('../../quality/mutation-uncovered.json', {
			with: { type: 'json' }
		})) as { default: UncoveredLedger };
		expect(ledgerFailures(ledger.default, await sourceFiles(projectRoot))).toEqual([]);
	});
});
