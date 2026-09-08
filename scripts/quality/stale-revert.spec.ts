import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	declaredReverts,
	describeStaleReverts,
	findStaleReverts,
	linesAddedBy,
	parseWindowLog,
	repositoryGit,
	revertOf,
	revertWindowCommits,
	scanForStaleReverts,
	significantLines,
	undeclared
} from './stale-revert';
import type { CommitVersions, FileVersions, RevertGit, WindowCommit } from './stale-revert';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Main's copy: three lines the older copy never had. */
const after = 'const origin = required("FIT_PUBLIC_ORIGIN");\nexport const config = { origin };\n';
const before = 'const origin = "https://example.test";\nexport const config = { origin };\n';
const commit: CommitVersions = { sha: 'abc1234def', subject: 'main did this', before, after };
const file: FileVersions = { path: 'scripts/deploy/config.ts', base: after, head: before };

describe('significantLines', () => {
	it('trims, deduplicates and drops the lines every file shares', () => {
		expect(significantLines('\tconst a = 1;\n}\n);\n\n  const a = 1;\nconst b = 2;')).toEqual(
			new Set(['const a = 1;', 'const b = 2;'])
		);
	});

	it('has no lines for a file that does not exist', () => {
		expect(significantLines(null).size).toBe(0);
	});
});

describe('linesAddedBy', () => {
	it('reports only what the change introduced', () => {
		expect(linesAddedBy(before, after)).toEqual(['const origin = required("FIT_PUBLIC_ORIGIN");']);
	});

	it('reports every line when the file is new', () => {
		expect(linesAddedBy(null, 'const b = 2;\n')).toEqual(['const b = 2;']);
	});

	it('reports nothing when the change only deleted', () => {
		expect(linesAddedBy(after, 'export const config = { origin };\n')).toEqual([]);
	});
});

describe('revertOf', () => {
	it('reports a branch holding the copy main had before the commit', () => {
		expect(revertOf(file, commit)).toEqual({
			path: 'scripts/deploy/config.ts',
			sha: 'abc1234def',
			subject: 'main did this',
			removed: 1,
			identical: true
		});
	});

	it('reports a copy that is older without being byte-identical', () => {
		const trimmed = { ...file, head: 'const origin = "https://example.test";\n' };
		expect(revertOf(trimmed, commit)).toMatchObject({ removed: 1, identical: false });
	});

	it('is silent when the branch does not change the file', () => {
		expect(revertOf({ ...file, head: after }, commit)).toBeNull();
	});

	it('is silent when the branch adds the file', () => {
		expect(revertOf({ ...file, base: null }, commit)).toBeNull();
	});

	it('is silent when the branch deletes the file outright', () => {
		expect(revertOf({ ...file, head: null }, commit)).toBeNull();
	});

	it('is silent for a main commit that only deleted from the file', () => {
		const deletion = { ...commit, before: after, after: 'export const config = { origin };\n' };
		expect(revertOf({ ...file, base: after, head: before }, deletion)).toBeNull();
	});

	it('is silent for a main commit that added nothing to the file', () => {
		expect(revertOf(file, { ...commit, before: after, after: before })).toBeNull();
	});

	it('is silent when main itself has already replaced those lines', () => {
		const moved = { ...file, base: 'const origin = required("SOMETHING_ELSE");\n' };
		expect(revertOf(moved, commit)).toBeNull();
	});

	it('is silent when the branch keeps what the commit added', () => {
		const kept = { ...file, head: `${after}export const extra = 1;\n` };
		expect(revertOf(kept, commit)).toBeNull();
	});

	it('is silent when the branch writes something the older copy never had', () => {
		const reworked = { ...file, head: `${before}const origin = readOrigin(env);\n` };
		expect(revertOf(reworked, commit)).toBeNull();
	});
});

describe('findStaleReverts', () => {
	it('reports the newest commit a file reverts and stops there', () => {
		const older: CommitVersions = { ...commit, sha: 'older99', subject: 'older' };
		const findings = findStaleReverts([{ file, commits: [commit, older] }]);
		expect(findings.map((finding) => finding.sha)).toEqual(['abc1234def']);
	});

	it('keeps the order of the files it was given, and skips clean ones', () => {
		const clean = { file: { ...file, path: 'clean.ts', head: after }, commits: [commit] };
		const findings = findStaleReverts([
			clean,
			{ file: { ...file, path: 'dirty.ts' }, commits: [commit] }
		]);
		expect(findings.map((finding) => finding.path)).toEqual(['dirty.ts']);
	});
});

describe('describeStaleReverts', () => {
	it('names the path, the commit it undoes, and what to do', () => {
		const [line] = describeStaleReverts([
			{ path: 'a.ts', sha: 'abc1234def', subject: 'main did this', removed: 1, identical: true }
		]);
		expect(line).toContain('a.ts: this branch restores the copy main had before abc1234');
		expect(line).toContain('drops all 1 line that commit added, byte for byte');
		expect(line).toContain('Rebase onto main');
	});

	it('counts more than one line, and says nothing about bytes when the copy is edited', () => {
		const [line] = describeStaleReverts([
			{ path: 'a.ts', sha: 'abc1234def', subject: 's', removed: 4, identical: false }
		]);
		expect(line).toContain('drops all 4 lines that commit added.');
	});
});

describe('parseWindowLog', () => {
	it('reads hash, subject and changed paths per commit', () => {
		expect(
			parseWindowLog('\0aaa111\0first thing\n\nsrc/a.ts\nsrc/b.ts\n\0bbb222\0second\n\nsrc/c.ts\n')
		).toEqual([
			{ sha: 'aaa111', subject: 'first thing', paths: ['src/a.ts', 'src/b.ts'] },
			{ sha: 'bbb222', subject: 'second', paths: ['src/c.ts'] }
		]);
	});

	it('gives a commit with no listed paths an empty path list', () => {
		expect(parseWindowLog('\0aaa111\0a merge\n')).toEqual([
			{ sha: 'aaa111', subject: 'a merge', paths: [] }
		]);
	});

	it('reads nothing from an empty log', () => {
		expect(parseWindowLog('')).toEqual([]);
	});
});

describe('declaredReverts and undeclared', () => {
	const finding = { path: 'a.ts', sha: 'abc1234def', subject: 's', removed: 1, identical: true };

	it('reads a Reverts trailer out of a commit message on the branch', () => {
		expect(
			declaredReverts('fix: put it back\n\nReverts: ABC1234\nCo-Authored-By: someone\n')
		).toEqual(['abc1234']);
	});

	it('ignores a mention that is not a trailer line', () => {
		expect(declaredReverts('this reverts: abc1234 in passing\n')).toEqual([]);
	});

	it('clears a finding the branch declares, by abbreviated hash', () => {
		expect(undeclared([finding], ['abc1234'])).toEqual([]);
	});

	it('keeps a finding against a commit the branch did not name', () => {
		expect(undeclared([finding], ['9999999'])).toEqual([finding]);
	});
});

/** A `RevertGit` over in-memory blobs, for the reads `scanForStaleReverts` makes. */
function fakeGit(
	blobs: Record<string, string>,
	changed: string[],
	reads: string[] = []
): RevertGit {
	return {
		mergeBase: () => Promise.resolve('base'),
		changedPaths: () => Promise.resolve(changed),
		window: () => Promise.resolve([]),
		branchMessages: () => Promise.resolve(''),
		blob: (rev, filePath) => {
			reads.push(`${rev}:${filePath}`);
			return Promise.resolve(blobs[`${rev}:${filePath}`] ?? null);
		}
	};
}

describe('scanForStaleReverts', () => {
	const window: WindowCommit[] = [{ sha: 'C', subject: 'main did this', paths: ['config.ts'] }];
	const blobs = {
		'base:config.ts': after,
		'head:config.ts': before,
		'C:config.ts': after,
		'C^:config.ts': before
	};

	it('reports the file the branch reverted', async () => {
		const findings = await scanForStaleReverts(
			fakeGit(blobs, ['config.ts']),
			'base',
			'head',
			window
		);
		expect(findings).toEqual([
			{
				path: 'config.ts',
				sha: 'C',
				subject: 'main did this',
				removed: 1,
				identical: true
			}
		]);
	});

	it('reads no blob for a path no commit in the window touched', async () => {
		const reads: string[] = [];
		const findings = await scanForStaleReverts(
			fakeGit(blobs, ['untouched.ts'], reads),
			'base',
			'head',
			window
		);
		expect(findings).toEqual([]);
		expect(reads).toEqual([]);
	});

	it('reads no commit blob once both copies on the branch match', async () => {
		const reads: string[] = [];
		const same = { ...blobs, 'head:config.ts': after };
		await scanForStaleReverts(fakeGit(same, ['config.ts'], reads), 'base', 'head', window);
		expect(reads).toEqual(['base:config.ts', 'head:config.ts']);
	});

	it('reads no commit blob for a file the branch adds', async () => {
		const reads: string[] = [];
		const added = { 'head:config.ts': before };
		await scanForStaleReverts(fakeGit(added, ['config.ts'], reads), 'base', 'head', window);
		expect(reads).toEqual(['base:config.ts', 'head:config.ts']);
	});
});

/**
 * The real case, rebuilt from the history of this repository, because the branch
 * that carried it is gone from the clone once its pull request merged.
 *
 * #223 landed as `70665ea`. #230 was cut before it, and its rebase produced a
 * commit whose copies of these nine files were byte-identical to `70665ea~1`,
 * so merging it as `4290ddf` took #223 back out. The branch tip is reconstructed
 * here as exactly that: main at `f54dcf3` for everything, and the pre-#223 copy
 * for the nine files the rebase carried. It was checked against the real branch
 * commit, `a4b2281`, which was byte-identical on all nine.
 *
 * These tests read the repository, so they need its history: a shallow clone
 * cannot answer them, which is why every gate job checks out with fetch-depth 0.
 */
describe('the branch that reverted #223', () => {
	const git = repositoryGit(projectRoot);
	const base = 'f54dcf34012a7ac973ce351074d7d9cff6a022fd';
	const carried = [
		'ORCHESTRATOR.md',
		'README.md',
		'scripts/android/release-plan.spec.ts',
		'scripts/deploy/config.ts',
		'scripts/deploy/deploy.spec.ts',
		'scripts/deploy/deploy.ts',
		'scripts/deploy/fit.env.example',
		'scripts/deploy/smoke.spec.ts',
		'scripts/deploy/smoke.ts'
	];
	/** The branch tip: main as it stood, plus the nine files as they were before #223. */
	const branch: RevertGit = {
		...git,
		changedPaths: () => Promise.resolve(carried),
		blob: async (rev, filePath) => await git.blob(rev === 'BRANCH' ? '70665ea^' : rev, filePath)
	};

	it('is caught, naming every file and the commit it takes back', async () => {
		const window = await git.window(base, revertWindowCommits);
		const findings = await scanForStaleReverts(branch, base, 'BRANCH', window);
		expect(findings.map((finding) => finding.path)).toEqual(carried);
		expect(findings.every((finding) => finding.sha.startsWith('70665ea'))).toBe(true);
		expect(findings.every((finding) => finding.identical)).toBe(true);
		expect(describeStaleReverts(findings)[0]).toContain('the public origin is environment-driven');
	});

	it('would have been cleared only by a branch declaring that revert', async () => {
		const window = await git.window(base, revertWindowCommits);
		const findings = await scanForStaleReverts(branch, base, 'BRANCH', window);
		expect(undeclared(findings, declaredReverts('feat: labels\n\nReverts: 70665ea\n'))).toEqual([]);
		expect(undeclared(findings, [])).toHaveLength(carried.length);
	});

	it('says nothing about a merge that reverted nothing', async () => {
		const head = 'c388bd9';
		const parent = await git.mergeBase(`${head}^`, head);
		const window = await git.window(parent, revertWindowCommits);
		expect(await scanForStaleReverts(git, parent, head, window)).toEqual([]);
		expect(await git.branchMessages(parent, head)).toContain('360px');
	});
});
