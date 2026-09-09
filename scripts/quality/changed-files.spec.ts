import { describe, expect, it } from 'vitest';
import {
	changedFilesForLint,
	committedSinceMergeBase,
	filterByExtension,
	mergeFileLists,
	stagedFiles,
	stagedFilesForLint,
	unstagedFiles,
	type GitRunner
} from './changed-files';

/** A `GitRunner` stub that answers by matching the leading git subcommand. */
function fakeGit(answers: {
	diffCached?: string[];
	diffUnstaged?: string[];
	diffSinceMergeBase?: string[];
	mergeBase?: string;
}): GitRunner {
	return (args) => {
		if (args[0] === 'merge-base') return Promise.resolve(answers.mergeBase ?? 'base-sha');
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

describe('stagedFiles / unstagedFiles / committedSinceMergeBase', () => {
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

	it('returns an empty list when there is nothing changed in that category', async () => {
		const git = fakeGit({});
		expect(await stagedFiles(git)).toEqual([]);
		expect(await unstagedFiles(git)).toEqual([]);
		expect(await committedSinceMergeBase(git, 'origin/main')).toEqual([]);
	});
});

describe('changedFilesForLint', () => {
	it('merges staged, unstaged and committed-since-merge-base, filtered to linted extensions', async () => {
		const git = fakeGit({
			diffCached: ['src/staged.ts', 'README.md'],
			diffUnstaged: ['src/unstaged.svelte'],
			diffSinceMergeBase: ['src/committed.ts', 'src/staged.ts']
		});
		expect(await changedFilesForLint(git, 'origin/main')).toEqual([
			'src/committed.ts',
			'src/staged.ts',
			'src/unstaged.svelte'
		]);
	});

	it('is the empty set when nothing changed at all', async () => {
		const git = fakeGit({});
		expect(await changedFilesForLint(git, 'origin/main')).toEqual([]);
	});

	it('is the empty set when everything changed is a non-linted extension', async () => {
		const git = fakeGit({
			diffCached: ['README.md'],
			diffUnstaged: ['docs/notes.md'],
			diffSinceMergeBase: ['package-lock.json']
		});
		expect(await changedFilesForLint(git, 'origin/main')).toEqual([]);
	});
});

describe('stagedFilesForLint', () => {
	it('looks only at the index, filtered to linted extensions', async () => {
		const git = fakeGit({ diffCached: ['src/a.ts', 'README.md', 'src/b.svelte'] });
		expect(await stagedFilesForLint(git)).toEqual(['src/a.ts', 'src/b.svelte']);
	});

	it('is the empty set when nothing is staged', async () => {
		const git = fakeGit({});
		expect(await stagedFilesForLint(git)).toEqual([]);
	});
});
