import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allSourceFiles, importingSpecsOf, logFileName } from './verify-changed';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('logFileName', () => {
	it('stays short even for a diff that touches many spec files (#141)', () => {
		const files = Array.from(
			{ length: 40 },
			(_, index) => `src/lib/components/widget-${index}.spec.ts`
		);
		const name = logFileName('specs', files);
		expect(name.length).toBeLessThan(100);
	});

	it('is stable across runs for the same file list', () => {
		const files = Array.from(
			{ length: 40 },
			(_, index) => `src/lib/components/widget-${index}.spec.ts`
		);
		expect(logFileName('specs', files)).toBe(logFileName('specs', files));
	});

	it('names the log after the step, not the file list', () => {
		const files = ['src/lib/a.spec.ts', 'src/lib/b.spec.ts'];
		expect(logFileName('specs', files)).toMatch(/^specs-[0-9a-f]{8}$/);
	});

	it('differs when the file list differs', () => {
		const a = logFileName('specs', ['src/lib/a.spec.ts']);
		const b = logFileName('specs', ['src/lib/b.spec.ts']);
		expect(a).not.toBe(b);
	});
});

describe('importingSpecsOf (#154: one level of reverse imports)', () => {
	it('selects the spec of a component that imports the changed file, in the real tree', async () => {
		// TodayView.svelte.spec.ts never mentions WeekStrip at all — it only
		// imports TodayView.svelte — so only a reverse-import lookup through
		// TodayView.svelte (which does import WeekStrip) finds that spec.
		const allFiles = await allSourceFiles();
		const specs = await importingSpecsOf('src/lib/components/WeekStrip.svelte', allFiles);
		expect(specs).toContain('src/lib/components/TodayView.svelte.spec.ts');
	});

	it('does not select an unrelated component spec', async () => {
		const allFiles = await allSourceFiles();
		const specs = await importingSpecsOf('src/lib/components/NavLink.svelte', allFiles);
		expect(specs).not.toContain('src/lib/components/TodayView.svelte.spec.ts');
	});

	const fixtureRoot = path.join(projectRoot, 'reports/tmp/verify-changed-154');
	const fixtureFile = (name: string): string => `reports/tmp/verify-changed-154/${name}`;

	afterEach(async () => {
		await rm(fixtureRoot, { recursive: true, force: true });
	});

	async function writeFixture(name: string, content: string): Promise<void> {
		await mkdir(fixtureRoot, { recursive: true });
		await writeFile(path.join(fixtureRoot, name), content);
	}

	it('resolves both a $lib alias import and a relative import to the same changed file', async () => {
		await writeFixture('Changed.svelte', '<script>\n</script>\n');
		await writeFixture(
			'AliasImporter.svelte',
			"<script>\n\timport Changed from '$lib/fixtures/Changed.svelte';\n</script>\n"
		);
		await writeFixture(
			'AliasImporter.svelte.spec.ts',
			"import { it } from 'vitest';\nit('x', () => {});\n"
		);
		await writeFixture(
			'RelativeImporter.svelte',
			"<script>\n\timport Changed from './Changed.svelte';\n</script>\n"
		);
		await writeFixture(
			'RelativeImporter.svelte.spec.ts',
			"import { it } from 'vitest';\nit('x', () => {});\n"
		);
		await writeFixture(
			'NotAnImporter.svelte',
			"<script>\n\timport Other from './ChangedFoo.svelte';\n</script>\n"
		);
		await writeFixture(
			'NotAnImporter.svelte.spec.ts',
			"import { it } from 'vitest';\nit('x', () => {});\n"
		);

		const allFiles = [
			fixtureFile('Changed.svelte'),
			fixtureFile('AliasImporter.svelte'),
			fixtureFile('AliasImporter.svelte.spec.ts'),
			fixtureFile('RelativeImporter.svelte'),
			fixtureFile('RelativeImporter.svelte.spec.ts'),
			fixtureFile('NotAnImporter.svelte'),
			fixtureFile('NotAnImporter.svelte.spec.ts')
		];
		const specs = await importingSpecsOf(fixtureFile('Changed.svelte'), allFiles);

		expect(specs).toContain(fixtureFile('AliasImporter.svelte.spec.ts'));
		expect(specs).toContain(fixtureFile('RelativeImporter.svelte.spec.ts'));
		expect(specs).not.toContain(fixtureFile('NotAnImporter.svelte.spec.ts'));
	});
});
