/**
 * Which files a local lint pass should look at before a push (issue #128):
 * everything changed since `HEAD` diverged from `origin/main`, plus whatever
 * is staged or sitting unstaged right now, filtered down to the extensions
 * `eslint.config.js` actually lints. The pre-commit hook uses the staged-only
 * half of this — the index is all a commit is about to capture.
 *
 * Git does the diffing; this module only merges, dedupes and filters its
 * output, and it takes the git call as a parameter so that logic is testable
 * without a real repository (see `changed-files.spec.ts`).
 */

import { capture } from '../security/shared';

/**
 * Extensions ESLint's flat config actually lints in this tree: `.ts` and
 * `.svelte` everywhere, `.js`/`.mjs` for the handful of plain-JS config and
 * script files. Checked against `git ls-files` — no `.cjs`, `.jsx` or `.tsx`
 * exists in the repository today.
 */
export const LINTED_EXTENSIONS = ['.ts', '.svelte', '.js', '.mjs'] as const;

/** Runs `git` with `args` from the project root and resolves to its stdout. */
export type GitRunner = (args: string[]) => Promise<string>;

/** The real `GitRunner`, shelling out via the shared child-process helper. */
export const runGit: GitRunner = (args) => capture('git', args);

export function filterByExtension(
	files: readonly string[],
	extensions: readonly string[] = LINTED_EXTENSIONS
): string[] {
	return files.filter((file) => extensions.some((extension) => file.endsWith(extension)));
}

/** Dedupes across lists, keeping each file's first-seen order. */
export function mergeFileLists(...lists: readonly (readonly string[])[]): string[] {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const list of lists) {
		for (const file of list) {
			if (!seen.has(file)) {
				seen.add(file);
				merged.push(file);
			}
		}
	}
	return merged;
}

/**
 * `git diff --name-only`, filtered to added/copied/modified/renamed paths (a
 * deleted file has nothing left to lint) and NUL-separated so a path with a
 * space or a quote in it still parses correctly.
 */
async function diffNameOnly(git: GitRunner, args: readonly string[]): Promise<string[]> {
	const output = await git(['diff', '--name-only', '--diff-filter=ACMR', '-z', ...args]);
	return output.split('\0').filter(Boolean);
}

/** Files staged in the index right now. */
export function stagedFiles(git: GitRunner): Promise<string[]> {
	return diffNameOnly(git, ['--cached']);
}

/** Files changed in the working tree but not staged. */
export function unstagedFiles(git: GitRunner): Promise<string[]> {
	return diffNameOnly(git, []);
}

/** Files committed on this branch since it diverged from `base`. */
export async function committedSinceMergeBase(git: GitRunner, base: string): Promise<string[]> {
	const mergeBase = (await git(['merge-base', 'HEAD', base])).trim();
	return diffNameOnly(git, [mergeBase, 'HEAD']);
}

/**
 * The full set a pre-push lint should cover: committed-since-merge-base,
 * unstaged and staged changes, merged and filtered to `extensions`.
 */
export async function changedFilesForLint(
	git: GitRunner,
	base = 'origin/main',
	extensions: readonly string[] = LINTED_EXTENSIONS
): Promise<string[]> {
	const [committed, unstaged, staged] = await Promise.all([
		committedSinceMergeBase(git, base),
		unstagedFiles(git),
		stagedFiles(git)
	]);
	return filterByExtension(mergeFileLists(committed, unstaged, staged), extensions);
}

/** Just what's staged, for the pre-commit hook. */
export async function stagedFilesForLint(
	git: GitRunner,
	extensions: readonly string[] = LINTED_EXTENSIONS
): Promise<string[]> {
	return filterByExtension(await stagedFiles(git), extensions);
}
