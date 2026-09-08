import { describe, expect, it } from 'vitest';
import { alwaysLoadedFiles, alwaysLoadedRoots } from './bundle-closure';
import type { ClientManifest } from './bundle-closure';

/**
 * Every fixture below is shaped like a Vite client manifest but names nothing
 * a real build emits: the content hashes are invented, and the assertions are
 * on those invented names. A closure that only worked against today's chunk
 * names would fail here.
 */
const manifest: ClientManifest = {
	'generated/app.js': {
		file: 'immutable/entry/app.aaaaaaaa.js',
		isEntry: true,
		imports: ['_shell.bbbbbbbb.js'],
		dynamicImports: ['generated/nodes/0.js', 'generated/nodes/2.js']
	},
	'node_modules/@sveltejs/kit/src/runtime/client/entry.js': {
		file: 'immutable/entry/start.cccccccc.js',
		isEntry: true,
		imports: ['_shell.bbbbbbbb.js']
	},
	'generated/nodes/0.js': {
		file: 'immutable/nodes/0.dddddddd.js',
		isEntry: true,
		imports: ['_layout-deps.eeeeeeee.js'],
		dynamicImports: ['_log-sheet.ffffffff.js']
	},
	'generated/nodes/2.js': {
		file: 'immutable/nodes/2.gggggggg.js',
		isEntry: true,
		imports: ['_home-only.hhhhhhhh.js']
	},
	'_shell.bbbbbbbb.js': { file: 'immutable/chunks/shell.bbbbbbbb.js' },
	'_layout-deps.eeeeeeee.js': {
		file: 'immutable/chunks/layout-deps.eeeeeeee.js',
		imports: ['_deep.iiiiiiii.js']
	},
	'_deep.iiiiiiii.js': { file: 'immutable/chunks/deep.iiiiiiii.js' },
	'_log-sheet.ffffffff.js': { file: 'immutable/chunks/log-sheet.ffffffff.js' },
	'_home-only.hhhhhhhh.js': { file: 'immutable/chunks/home-only.hhhhhhhh.js' }
};

describe('alwaysLoadedRoots', () => {
	it('takes the shell entries and the root layout node, and no other route node', () => {
		expect(alwaysLoadedRoots(manifest)).toEqual([
			'generated/app.js',
			'node_modules/@sveltejs/kit/src/runtime/client/entry.js',
			'generated/nodes/0.js'
		]);
	});

	it('refuses a manifest with no root layout node rather than measuring nothing', () => {
		const withoutRootLayout: ClientManifest = Object.fromEntries(
			Object.entries(manifest).filter(([key]) => key !== 'generated/nodes/0.js')
		);
		expect(() => alwaysLoadedRoots(withoutRootLayout)).toThrow(/root layout node/);
	});
});

describe('alwaysLoadedFiles', () => {
	it('excludes a dynamically imported chunk and the route node that reaches it', () => {
		const files = alwaysLoadedFiles(manifest);
		expect(files).not.toContain('immutable/chunks/log-sheet.ffffffff.js');
		expect(files).not.toContain('immutable/nodes/2.gggggggg.js');
		expect(files).not.toContain('immutable/chunks/home-only.hhhhhhhh.js');
	});

	it('follows static imports transitively and names each file once', () => {
		expect(alwaysLoadedFiles(manifest)).toEqual([
			'immutable/chunks/deep.iiiiiiii.js',
			'immutable/chunks/layout-deps.eeeeeeee.js',
			'immutable/chunks/shell.bbbbbbbb.js',
			'immutable/entry/app.aaaaaaaa.js',
			'immutable/entry/start.cccccccc.js',
			'immutable/nodes/0.dddddddd.js'
		]);
	});

	it('finds the same closure when every hash changes, since it walks keys not file names', () => {
		const rehashed: ClientManifest = Object.fromEntries(
			Object.entries(manifest).map(([key, chunk]) => [
				key,
				{ ...chunk, file: chunk.file.replace(/\.[a-z]{8}\.js$/, '.zzzzzzzz.js') }
			])
		);
		expect(alwaysLoadedFiles(rehashed)).toHaveLength(alwaysLoadedFiles(manifest).length);
		expect(alwaysLoadedFiles(rehashed)).toContain('immutable/chunks/deep.zzzzzzzz.js');
	});

	it('reports a manifest that imports a chunk it does not describe', () => {
		const dangling: ClientManifest = {
			...manifest,
			'_shell.bbbbbbbb.js': {
				file: 'immutable/chunks/shell.bbbbbbbb.js',
				imports: ['_missing.jjjjjjjj.js']
			}
		};
		expect(() => alwaysLoadedFiles(dangling)).toThrow(/does not describe/);
	});
});
