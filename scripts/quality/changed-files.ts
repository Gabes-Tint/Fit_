/**
 * Which files a local lint pass should look at before a push (issue #128):
 * everything changed since `HEAD` diverged from `origin/main`, plus whatever
 * is staged, unstaged or untracked right now, filtered down to the
 * extensions `eslint.config.js` actually lints and to paths that still exist
 * on disk. The pre-commit hook uses the staged-only half of this — a commit
 * only ever captures the current contents of the paths staged for it.
 *
 * Git does the diffing; this module only merges, dedupes and filters its
 * output, and it takes the git call (and the disk-existence check) as
 * parameters so that logic is testable without a real repository or
 * filesystem — see `changed-files.spec.ts`.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { capture, projectRoot } from '../security/shared';

/**
 * Extensions ESLint's flat config actually lints in this tree: `.ts` and
 * `.svelte` everywhere, `.js`/`.mjs` for the handful of plain-JS config and
 * script files. Checked against `git ls-files` — no `.cjs`, `.jsx` or `.tsx`
 * exists in the repository today.
 */
const LINTED_EXTENSIONS = ['.ts', '.svelte', '.js', '.mjs'] as const;

/** Runs `git` with `args` from the project root and resolves to its stdout. */
export type GitRunner = (args: string[]) => Promise<string>;

/** The real `GitRunner`, shelling out via the shared child-process helper. */
export const runGit: GitRunner = (args) => capture('git', args);

/** Whether a repo-relative path currently exists on disk. */
export type FileExists = (file: string) => boolean;

/** The real `FileExists`, resolved against the project root. */
const existsOnDisk: FileExists = (file) => existsSync(path.join(projectRoot, file));

export function filterByExtension(
	files: readonly string[],
	extensions: readonly string[] = LINTED_EXTENSIONS
): string[] {
	return files.filter((file) => extensions.some((extension) => file.endsWith(extension)));
}

/**
 * Drops paths ESLint would fail to open: a path can survive the diff and
 * extension filters yet no longer exist on disk — for example a file this
 * branch added or modified since the merge-base, then removed from the
 * working tree without staging that removal. ESLint exits 2 ("No files
 * matching the pattern") on a stale path instead of reporting 0 problems for
 * it, which `eslint.ts` reads as a crash rather than a clean lint.
 */
export function filterExisting(
	files: readonly string[],
	exists: FileExists = existsOnDisk
): string[] {
	return files.filter((file) => exists(file));
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

/** `git diff`'s `--diff-filter` value: added, copied, modified or renamed — never deleted, since a removed path has nothing left to lint. */
const DIFF_FILTER = ['A', 'C', 'M', 'R'].join('');

/**
 * `git diff --name-only`, filtered to non-deleted paths and NUL-separated so
 * a path with a space or a quote in it still parses correctly.
 */
async function diffNameOnly(git: GitRunner, args: readonly string[]): Promise<string[]> {
	const output = await git(['diff', '--name-only', `--diff-filter=${DIFF_FILTER}`, '-z', ...args]);
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

/** Files git does not track and nothing ignores — new files nobody has staged yet. */
export async function untrackedFiles(git: GitRunner): Promise<string[]> {
	const output = await git(['ls-files', '--others', '--exclude-standard', '-z']);
	return output.split('\0').filter(Boolean);
}

/**
 * The full set a pre-push lint should cover: committed-since-merge-base,
 * unstaged, staged and untracked changes, merged, filtered to `extensions`,
 * and filtered again to paths that still exist on disk.
 */
export async function changedFilesForLint(
	git: GitRunner,
	base = 'origin/main',
	extensions: readonly string[] = LINTED_EXTENSIONS,
	exists: FileExists = existsOnDisk
): Promise<string[]> {
	const [committed, unstaged, staged, untracked] = await Promise.all([
		committedSinceMergeBase(git, base),
		unstagedFiles(git),
		stagedFiles(git),
		untrackedFiles(git)
	]);
	return filterExisting(
		filterByExtension(mergeFileLists(committed, unstaged, staged, untracked), extensions),
		exists
	);
}

/** Just what's staged, for the pre-commit hook. */
export async function stagedFilesForLint(
	git: GitRunner,
	extensions: readonly string[] = LINTED_EXTENSIONS,
	exists: FileExists = existsOnDisk
): Promise<string[]> {
	return filterExisting(filterByExtension(await stagedFiles(git), extensions), exists);
}
