import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `perf:measure` is `node scripts/perf/measure.ts`, not `bun run`, because
 * instrument 4 needs `node:sqlite`. Plain Node does not resolve a specifier
 * that omits its extension the way Vite does, so one import without
 * one anywhere in this directory's runtime graph stops the whole entry point
 * loading — which is exactly what happened when the shared JSON read was
 * introduced (#172): every instrument had been unreachable since, and nothing
 * failed, because no gate runs this command.
 *
 * A value import is what matters; `import type` is erased before Node sees it.
 */
const directory = path.join(import.meta.dirname);
const RELATIVE_VALUE_IMPORT = /^import\s+(?!type\s)[^;]*?from\s+'(\.[^']*)'/gm;

describe('scripts/perf runs under plain node', () => {
	it('names the extension on every relative value import', async () => {
		const offenders: string[] = [];
		for (const entry of (await readdir(directory)).sort()) {
			if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
			const source = await readFile(path.join(directory, entry), 'utf8');
			for (const match of source.matchAll(RELATIVE_VALUE_IMPORT)) {
				const specifier = match[1] ?? '';
				if (!/\.[cm]?ts$/.test(specifier)) offenders.push(`${entry}: ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
