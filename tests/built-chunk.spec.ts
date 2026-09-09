import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { builtChunkPathContaining } from './built-chunk';

/**
 * `lazy-shell.e2e.ts` stalls one chunk by its URL, and gets that URL from here.
 * A lookup that returned nothing, or the wrong one of several, would leave that
 * test intercepting a URL the browser never asks for -- green, and asserting
 * nothing about the drawer at all. So a miss and an ambiguity are both errors.
 */
describe('finding a built chunk by what is in it', () => {
	const directories: string[] = [];

	function buildOutput(files: Record<string, string>): string {
		const root = mkdtempSync(join(tmpdir(), 'built-chunk-'));
		directories.push(root);
		for (const [name, contents] of Object.entries(files)) {
			mkdirSync(join(root, name, '..'), { recursive: true });
			writeFileSync(join(root, name), contents);
		}
		return root;
	}

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	it('gives the URL path of the one chunk that contains the marker', () => {
		const root = buildOutput({
			'_app/immutable/chunks/A1b2C3d4.js': 'export const nav = "Everything stays here.";',
			'_app/immutable/entry/start.js': 'export const start = 1;'
		});
		expect(builtChunkPathContaining('Everything stays here.', root)).toBe(
			'/_app/immutable/chunks/A1b2C3d4.js'
		);
	});

	it('refuses a marker no chunk contains, rather than naming none', () => {
		const root = buildOutput({ '_app/immutable/chunks/A1b2C3d4.js': 'export const nav = 1;' });
		expect(() => builtChunkPathContaining('Everything stays here.', root)).toThrow(/none does/);
	});

	it('refuses a marker several chunks contain, rather than picking one', () => {
		const root = buildOutput({
			'_app/immutable/chunks/A1b2C3d4.js': '"Everything stays here."',
			'_app/immutable/chunks/E5f6G7h8.js': '"Everything stays here."'
		});
		expect(() => builtChunkPathContaining('Everything stays here.', root)).toThrow(/2 do/);
	});

	it('looks in scripts only, so a stylesheet quoting the text names nothing', () => {
		const root = buildOutput({
			'_app/immutable/assets/app.css': '.nav::after { content: "Everything stays here."; }'
		});
		expect(() => builtChunkPathContaining('Everything stays here.', root)).toThrow(/none does/);
	});
});
