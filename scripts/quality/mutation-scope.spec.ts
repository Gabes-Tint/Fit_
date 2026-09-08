import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	buildMutationScope,
	discoverSecurityRoots,
	expandRuntimeImports,
	isMutated,
	isServerSource
} from './mutation-scope';
import { fileURLToPath } from 'node:url';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'fit-mutation-scope-'));
	roots.push(root);
	await writeFile(
		path.join(root, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: { moduleResolution: 'bundler', paths: { '$lib/*': ['./src/lib/*'] } }
		})
	);
	await mkdir(path.join(root, 'src/lib/server'), { recursive: true });
	await mkdir(path.join(root, 'src/lib/shared'), { recursive: true });
	await mkdir(path.join(root, 'src/routes/api'), { recursive: true });
	return root;
}

function git(root: string, args: string[]): void {
	execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

async function committedProject(): Promise<string> {
	const root = await project();
	await mkdir(path.join(root, 'src/lib/domain'), { recursive: true });
	await writeFile(path.join(root, 'src/lib/domain/base.ts'), 'export const base = 1;\n');
	git(root, ['init']);
	git(root, ['config', 'user.email', 'fixture@example.test']);
	git(root, ['config', 'user.name', 'Fixture']);
	git(root, ['add', '-A']);
	git(root, ['commit', '-m', 'fixture']);
	return root;
}

describe('mutation security scope', () => {
	it('discovers hooks, lib server modules and every SvelteKit server entrypoint', async () => {
		const root = await project();
		await Promise.all([
			writeFile(path.join(root, 'src/hooks.server.ts'), 'export const handle = () => 1;\n'),
			writeFile(path.join(root, 'src/lib/server/auth.ts'), 'export const auth = true;\n'),
			writeFile(path.join(root, 'src/lib/server/auth.spec.ts'), 'test("x", () => {});\n'),
			writeFile(path.join(root, 'src/routes/api/+server.ts'), 'export const GET = () => 1;\n'),
			writeFile(
				path.join(root, 'src/routes/api/+page.server.ts'),
				'export const load = () => 1;\n'
			),
			writeFile(
				path.join(root, 'src/routes/api/+layout.server.ts'),
				'export const load = () => 1;\n'
			)
		]);
		expect(await discoverSecurityRoots(root)).toEqual([
			'src/hooks.server.ts',
			'src/lib/server/auth.ts',
			'src/routes/api/+layout.server.ts',
			'src/routes/api/+page.server.ts',
			'src/routes/api/+server.ts'
		]);
	});

	it('classifies a route server spec into the server project, not a component spec', () => {
		expect(isServerSource('src/routes/api/accounts/server.spec.ts')).toBe(true);
		expect(isServerSource('src/lib/components/AvgRow.svelte.spec.ts')).toBe(false);
	});

	it('includes transitive local runtime imports but not type-only imports', async () => {
		const root = await project();
		await Promise.all([
			writeFile(
				path.join(root, 'src/lib/server/auth.ts'),
				"import { helper } from '$lib/shared/helper';\nimport type { Shape } from '$lib/shared/types';\nexport const auth = helper();\nexport const lazy = () => import(`$lib/shared/lazy`);\n"
			),
			writeFile(path.join(root, 'src/lib/shared/helper.ts'), 'export const helper = () => true;\n'),
			writeFile(path.join(root, 'src/lib/shared/lazy.ts'), 'export const lazy = true;\n'),
			writeFile(
				path.join(root, 'src/lib/shared/types.ts'),
				'export interface Shape { ok: boolean }\n'
			)
		]);
		expect(await expandRuntimeImports(root, ['src/lib/server/auth.ts'])).toEqual([
			'src/lib/server/auth.ts',
			'src/lib/shared/helper.ts',
			'src/lib/shared/lazy.ts'
		]);
	});

	it('fails closed when a security import target is computed at runtime', async () => {
		const root = await project();
		await writeFile(
			path.join(root, 'src/lib/server/auth.ts'),
			"export async function provider(name: string) { return import('./providers/' + name); }\n"
		);
		await expect(expandRuntimeImports(root, ['src/lib/server/auth.ts'])).rejects.toThrow(
			'Cannot prove mutation scope for computed dynamic import'
		);
	});

	it('selects an added Node file and records its exact changed lines', async () => {
		const root = await committedProject();
		await writeFile(
			path.join(root, 'src/lib/domain/changed.ts'),
			'export function changed(value: boolean) {\n\treturn value ? 1 : 2;\n}\n'
		);
		git(root, ['add', 'src/lib/domain/changed.ts']);
		const scope = await buildMutationScope(root, 'changed-node', 'HEAD');
		expect(scope.fallback).toBeNull();
		expect(scope.files).toEqual([
			{
				path: 'src/lib/domain/changed.ts',
				changeStatus: 'A',
				changedLines: [{ start: 1, end: 3 }]
			}
		]);
	});

	it('broadens the affected lane when a test changes', async () => {
		const root = await committedProject();
		await writeFile(path.join(root, 'src/lib/domain/base.spec.ts'), 'import "./base";\n');
		git(root, ['add', 'src/lib/domain/base.spec.ts']);
		const scope = await buildMutationScope(root, 'changed-node', 'HEAD');
		expect(scope.fallback).toBe('test-input-changed');
		expect(scope.files.map(({ path: file }) => file)).toContain('src/lib/domain/base.ts');
	});

	it('marks a deletion-only production edit as changed during broad fallback', async () => {
		const root = await committedProject();
		await writeFile(
			path.join(root, 'src/lib/domain/base.ts'),
			'export function base() {\n\tconst removed = 1;\n\treturn 1;\n}\n'
		);
		git(root, ['add', 'src/lib/domain/base.ts']);
		git(root, ['commit', '-m', 'expand fixture']);
		await writeFile(
			path.join(root, 'src/lib/domain/base.ts'),
			'export function base() {\n\treturn 1;\n}\n'
		);
		await writeFile(path.join(root, 'src/lib/domain/base.spec.ts'), 'import "./base";\n');
		const scope = await buildMutationScope(root, 'changed-node', 'HEAD');
		expect(scope.fallback).toBe('test-input-changed');
		expect(scope.files).toContainEqual({
			path: 'src/lib/domain/base.ts',
			changeStatus: 'M',
			changedLines: []
		});
	});

	it('never puts test, spec, or end-to-end artifacts in a production mutation scope', async () => {
		const root = await committedProject();
		await mkdir(path.join(root, 'src/routes'), { recursive: true });
		await Promise.all([
			writeFile(path.join(root, 'src/lib/domain/base.test.ts'), 'export const testOnly = true;\n'),
			writeFile(path.join(root, 'src/lib/domain/base.spec.ts'), 'export const specOnly = true;\n'),
			writeFile(path.join(root, 'src/routes/flow.e2e.ts'), 'export const endToEndOnly = true;\n')
		]);
		const scope = await buildMutationScope(root, 'full', 'HEAD');
		expect(scope.files.map(({ path: file }) => file)).toEqual(['src/lib/domain/base.ts']);
	});

	it('broadens rather than guessing when a tracked source is deleted', async () => {
		const root = await committedProject();
		await rm(path.join(root, 'src/lib/domain/base.ts'));
		const scope = await buildMutationScope(root, 'changed-node', 'HEAD');
		expect(scope.fallback).toBe('deleted-or-renamed-input');
	});

	it('broadens the client lane for runtime inputs Stryker does not mutate', async () => {
		const root = await committedProject();
		await writeFile(path.join(root, 'src/lib/view.svelte'), '<p>changed</p>\n');
		git(root, ['add', 'src/lib/view.svelte']);
		const scope = await buildMutationScope(root, 'changed-client', 'HEAD');
		expect(scope.fallback).toBe('non-mutated-runtime-input-changed');
	});

	it('selects an untracked Node file and treats every line as changed', async () => {
		const root = await committedProject();
		await writeFile(
			path.join(root, 'src/lib/domain/untracked.ts'),
			'export const first = true;\nexport const second = false;\n'
		);
		const scope = await buildMutationScope(root, 'changed-node', 'HEAD');
		expect(scope.files).toContainEqual({
			path: 'src/lib/domain/untracked.ts',
			changeStatus: 'A',
			changedLines: [{ start: 1, end: 2 }]
		});
	});

	it('leaves security-boundary specs to the always-on security lane', async () => {
		const root = await committedProject();
		await writeFile(path.join(root, 'src/hooks.server.ts'), 'export const handle = () => true;\n');
		await writeFile(path.join(root, 'src/hooks.server.spec.ts'), 'export const changed = true;\n');
		await writeFile(path.join(root, 'src/lib/server/auth.ts'), 'export const auth = true;\n');
		await writeFile(
			path.join(root, 'src/lib/server/auth.spec.ts'),
			'export const changed = true;\n'
		);
		git(root, ['add', '-A']);
		const node = await buildMutationScope(root, 'changed-node', 'HEAD');
		const client = await buildMutationScope(root, 'changed-client', 'HEAD');
		expect(node.fallback).toBeNull();
		expect(node.files).toEqual([]);
		expect(client.fallback).toBeNull();
		expect(client.files).toEqual([]);
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

describe('isMutated agrees with the lanes it describes', () => {
	it('claims every file the security lane actually hands Stryker (#129)', async () => {
		// The rule and the lane used to be written twice. `verify:changed` planned
		// with `src/lib/**`, so a change to an API handler scheduled no mutation
		// step at all while the security lane mutated ten files outside `src/lib`.
		const root = fileURLToPath(new URL('../../', import.meta.url));
		const scope = await buildMutationScope(root, 'security');
		const unclaimed = scope.files.map(({ path: file }) => file).filter((file) => !isMutated(file));
		expect(unclaimed).toEqual([]);
	});
});
