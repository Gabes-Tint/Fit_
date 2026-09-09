import { describe, expect, it } from 'vitest';
import {
	changedFilesForLint,
	committedSinceMergeBase,
	filterByExtension,
	filterExisting,
	mergeFileLists,
	stagedFiles,
	stagedFilesForLint,
	unstagedFiles,
	untrackedFiles,
	type GitRunner
} from './changed-files';

/** A `GitRunner` stub that answers by matching the leading git subcommand. */
function fakeGit(answers: {
	diffCached?: string[];
	diffUnstaged?: string[];
	diffSinceMergeBase?: string[];
	untracked?: string[];
	mergeBase?: string;
}): GitRunner {
	return (args) => {
		if (args[0] === 'merge-base') return Promise.resolve(answers.mergeBase ?? 'base-sha');
		if (args[0] === 'ls-files') {
			return Promise.resolve(`${(answers.untracked ?? []).join('\0')}\0`);
		}
		if (args[0] === 'diff' && args.includes('--cached')) {
			return Promise.resolve(`${(answers.diffCached ?? []).join('\0')}\0`);
		}
		if (args[0] === 'diff' && args.includes('base-sha')) {
			return Promise.resolve(`${(answers.diffSinceMergeBase ?? []).join('\0')}\0`);
		}
		if (args[0] === 'diff') return Promise.resolve(`${(answers.diffUnstaged ?? []).join('\0')}\0`);
		return Promise.reject(new Error(`unexpected git invocation: ${args.join(' ')}`));
	};
}

/** An always-true `FileExists`, for tests that don't care about disk state. */
const allExist = (): boolean => true;

describe('filterByExtension', () => {
	it('keeps only files whose extension is in the given list', () => {
		const files = ['a.ts', 'b.svelte', 'c.png', 'd.js', 'e.mjs', 'f.md'];
		expect(filterByExtension(files, ['.ts', '.svelte'])).toEqual(['a.ts', 'b.svelte']);
	});

	it('defaults to the extensions eslint.config.js actually lints', () => {
		const files = ['a.ts', 'b.svelte', 'c.js', 'd.mjs', 'e.cjs', 'f.png'];
		expect(filterByExtension(files)).toEqual(['a.ts', 'b.svelte', 'c.js', 'd.mjs']);
	});

	it('returns an empty list when nothing matches', () => {
		expect(filterByExtension(['a.png', 'b.md'], ['.ts'])).toEqual([]);
	});
});

describe('filterExisting', () => {
	it('drops paths the exists check rejects', () => {
		const exists = (file: string): boolean => file !== 'src/gone.ts';
		expect(filterExisting(['src/a.ts', 'src/gone.ts', 'src/b.ts'], exists)).toEqual([
			'src/a.ts',
			'src/b.ts'
		]);
	});

	it('is the empty set when nothing exists', () => {
		expect(filterExisting(['a.ts', 'b.ts'], () => false)).toEqual([]);
	});

	it('keeps everything when everything exists', () => {
		expect(filterExisting(['a.ts', 'b.ts'], allExist)).toEqual(['a.ts', 'b.ts']);
	});
});

describe('mergeFileLists', () => {
	it('dedupes across lists, keeping first-seen order', () => {
		expect(mergeFileLists(['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['a.ts'])).toEqual([
			'a.ts',
			'b.ts',
			'c.ts'
		]);
	});

	it('returns an empty list when every input list is empty', () => {
		expect(mergeFileLists([], [], [])).toEqual([]);
	});
});

describe('stagedFiles / unstagedFiles / committedSinceMergeBase / untrackedFiles', () => {
	it('reads staged files from `git diff --cached`', async () => {
		const git = fakeGit({ diffCached: ['src/a.ts'] });
		expect(await stagedFiles(git)).toEqual(['src/a.ts']);
	});

	it('reads unstaged files from a plain `git diff`', async () => {
		const git = fakeGit({ diffUnstaged: ['src/b.ts'] });
		expect(await unstagedFiles(git)).toEqual(['src/b.ts']);
	});

	it('resolves the merge-base against the given ref before diffing', async () => {
		const git = fakeGit({ mergeBase: 'base-sha', diffSinceMergeBase: ['src/c.ts'] });
		expect(await committedSinceMergeBase(git, 'origin/main')).toEqual(['src/c.ts']);
	});

	it('reads untracked files from `git ls-files --others --exclude-standard`', async () => {
		const git = fakeGit({ untracked: ['src/new.ts'] });
		expect(await untrackedFiles(git)).toEqual(['src/new.ts']);
	});

	it('returns an empty list when there is nothing changed in that category', async () => {
		const git = fakeGit({});
		expect(await stagedFiles(git)).toEqual([]);
		expect(await unstagedFiles(git)).toEqual([]);
		expect(await committedSinceMergeBase(git, 'origin/main')).toEqual([]);
		expect(await untrackedFiles(git)).toEqual([]);
	});
});

describe('changedFilesForLint', () => {
	it('merges staged, unstaged, committed-since-merge-base and untracked, filtered to linted extensions', async () => {
		const git = fakeGit({
			diffCached: ['src/staged.ts', 'README.md'],
			diffUnstaged: ['src/unstaged.svelte'],
			diffSinceMergeBase: ['src/committed.ts', 'src/staged.ts'],
			untracked: ['src/new.ts']
		});
		expect(await changedFilesForLint(git, 'origin/main', undefined, allExist)).toEqual([
			'src/committed.ts',
			'src/staged.ts',
			'src/unstaged.svelte',
			'src/new.ts'
		]);
	});

	it('is the empty set when nothing changed at all', async () => {
		const git = fakeGit({});
		expect(await changedFilesForLint(git, 'origin/main', undefined, allExist)).toEqual([]);
	});

	it('is the empty set when everything changed is a non-linted extension', async () => {
		const git = fakeGit({
			diffCached: ['README.md'],
			diffUnstaged: ['docs/notes.md'],
			diffSinceMergeBase: ['package-lock.json'],
			untracked: ['notes.txt']
		});
		expect(await changedFilesForLint(git, 'origin/main', undefined, allExist)).toEqual([]);
	});

	it('drops a committed path that no longer exists on disk', async () => {
		const git = fakeGit({
			diffSinceMergeBase: ['src/committed.ts', 'src/deleted-outside-git.ts']
		});
		const exists = (file: string): boolean => file !== 'src/deleted-outside-git.ts';
		expect(await changedFilesForLint(git, 'origin/main', undefined, exists)).toEqual([
			'src/committed.ts'
		]);
	});
});

describe('stagedFilesForLint', () => {
	it('looks only at the index, filtered to linted extensions', async () => {
		const git = fakeGit({ diffCached: ['src/a.ts', 'README.md', 'src/b.svelte'] });
		expect(await stagedFilesForLint(git, undefined, allExist)).toEqual([
			'src/a.ts',
			'src/b.svelte'
		]);
	});

	it('is the empty set when nothing is staged', async () => {
		const git = fakeGit({});
		expect(await stagedFilesForLint(git, undefined, allExist)).toEqual([]);
	});

	it('drops a staged path that no longer exists on disk', async () => {
		const git = fakeGit({ diffCached: ['src/a.ts', 'src/gone.ts'] });
		const exists = (file: string): boolean => file !== 'src/gone.ts';
		expect(await stagedFilesForLint(git, undefined, exists)).toEqual(['src/a.ts']);
	});
});
