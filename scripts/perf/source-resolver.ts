import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A Node ESM resolve hook that makes `src/lib` importable from a script under
 * plain `node`, the way Vite already makes it importable from the application.
 *
 * Two things stop plain Node loading a server module today, and both of them
 * are Vite's job in every other caller:
 *
 *  - `$lib/domain/portions` is a SvelteKit alias. Node has no alias table, and
 *    `imports` in `package.json` cannot express it because a subpath import has
 *    to start with `#`.
 *  - `./unit-spellings` omits its extension. `rewriteRelativeImportExtensions`
 *    puts the `.js` back for the built server; the TypeScript source Node reads
 *    directly still says nothing.
 *
 * `scripts/eval/search-eval.ts` and `scripts/perf/sql-plans.ts` avoid both by
 * importing only the modules that happen to have neither — which is why
 * instrument 4 could not reach `portions.ts` and its statement went
 * hand-recorded. This is the general answer instead of a third module chosen
 * for what it does not import.
 *
 * Registered by `sql-dynamic.ts` before it imports anything under `src`, since
 * a static import is linked before any code in this process runs. Resolution
 * only: Node 24 strips the types itself.
 */

/** Where `$lib/...` points, as a `file:` URL ending in a slash. */
function libraryRoot(): string {
	return new URL('../../src/lib/', import.meta.url).href;
}

/**
 * `specifier` rewritten to something Node can resolve, or unchanged.
 *
 * Pure and exported so the rewrite is asserted directly: the hook itself runs
 * on a loader thread where a spec cannot see it.
 */
export function rewriteSpecifier(
	specifier: string,
	parentURL: string | undefined,
	exists: (path: string) => boolean = existsSync
): string {
	const aliased = specifier.startsWith('$lib/')
		? `${libraryRoot()}${specifier.slice('$lib/'.length)}`
		: specifier;
	const relative = aliased.startsWith('.') || aliased.startsWith('file:');
	if (!relative || /\.[cm]?[jt]s$/.test(aliased)) return aliased;
	// Only when the `.ts` file is really there: a specifier without one that
	// names a directory or a package is left for Node to resolve or reject.
	const candidate = `${fileURLToPath(new URL(aliased, parentURL))}.ts`;
	return exists(candidate) ? `${aliased}.ts` : aliased;
}

type NextResolve = (specifier: string, context: { parentURL?: string | undefined }) => unknown;

/** The hook Node calls. Named `resolve` because that is the contract. */
export function resolve(
	specifier: string,
	context: { parentURL?: string | undefined },
	next: NextResolve
): unknown {
	return next(rewriteSpecifier(specifier, context.parentURL), context);
}
