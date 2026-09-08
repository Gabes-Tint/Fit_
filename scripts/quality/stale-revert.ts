import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Catches the one failure every other gate is blind to: a branch that carries a
 * stale copy of a file it never meant to edit, and reverts somebody else's
 * merged work when it lands.
 *
 * #230 is the case this was written from. It was serving-label work, it named no
 * deploy file, and its rebase produced a commit whose copies of nine files --
 * `scripts/deploy/config.ts` among them -- were byte-identical to their state
 * *before* #223 had made `FIT_PUBLIC_ORIGIN` required. Merging it removed 188
 * lines and put a smoke test that hits production back on every deploy. Both
 * branches were green throughout, because a gate judges the branch's own tree:
 * it builds, its tests pass, it is under budget. Nothing asks whether the tree
 * is *older than main's*, and after a successful rebase there is no conflict to
 * ask on -- the reverted lines read as deliberate deletions.
 *
 * The question this asks is therefore relative, not absolute. For every file the
 * branch changes, and every recent commit on main that also changed it: is what
 * the branch has here simply what main had before that commit?
 *
 * A finding needs all four to hold for one file and one main commit `C`:
 *
 *   1. The branch changes the file, and neither adds nor deletes it outright. A
 *      whole-file add or delete is loud in review; the hazard here is quiet.
 *   2. `C`'s additions are still intact at the merge base. If main itself has
 *      since replaced them, the branch is not the one removing them.
 *   3. Not one of `C`'s added lines survives in the branch's copy.
 *   4. The branch's copy contains nothing that main did not already have before
 *      `C`. This is what "not editing the file for its own purpose" means, and
 *      it is what keeps the check quiet: a pull request that genuinely reworks
 *      those lines writes something new into the file, and is never reported.
 *
 * Conditions 3 and 4 together say the branch restores an older state of the
 * file rather than authoring one, which is exactly the stale-copy shape and is
 * why this fails a build rather than warning. It stays silent on a branch that
 * is merely behind main: without its own edit to the file, a merge takes main's
 * copy and nothing is lost.
 *
 * The one branch that reverts merged work on purpose says so: a `Reverts: <sha>`
 * trailer in one of its own commit messages clears findings against that commit
 * and nothing else. Over the sixty merges before this was written the rule fired
 * twice -- on #230, and on #240, the pull request that undid #230 on purpose --
 * so the escape hatch exists because the second of those is a legitimate change
 * that must still be able to land. It is a claim about one named commit, written
 * into the branch's history where review reads it, not a switch that turns the
 * check off.
 */

/**
 * How far back on main a finding can reach. First-parent, so on this repository
 * one commit is one merged pull request: 40 is the last 40 merges, several
 * weeks. Work older than that is not "somebody's merged work being reverted"
 * any more, it is code being deleted, which review is the right check for.
 */
export const revertWindowCommits = 40;

/**
 * Lines shorter than this are ignored on both sides of every comparison. `}`,
 * `);` and blank lines recur everywhere, so a file that shares only those with
 * an older copy shares nothing.
 */
export const significantLineLength = 4;

/** Blob contents of one path at the merge base and at the branch tip. */
export interface FileVersions {
	path: string;
	base: string | null;
	head: string | null;
}

/** Blob contents of one path either side of one commit on main. */
export interface CommitVersions {
	sha: string;
	subject: string;
	before: string | null;
	after: string | null;
}

/** One path, with the main commits that touched it, newest first. */
export interface FileHistory {
	file: FileVersions;
	commits: CommitVersions[];
}

export interface StaleRevert {
	path: string;
	sha: string;
	subject: string;
	/** How many lines that commit added to this file the branch drops. */
	removed: number;
	/** Whether the branch's copy is byte-identical to the pre-commit copy. */
	identical: boolean;
}

/** The lines of a file worth comparing, trimmed and deduplicated. */
export function significantLines(text: string | null): Set<string> {
	if (text === null) return new Set();
	return new Set(
		text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length >= significantLineLength)
	);
}

/** Significant lines present after a change and absent before it. */
export function linesAddedBy(before: string | null, after: string | null): string[] {
	const known = significantLines(before);
	return [...significantLines(after)].filter((line) => !known.has(line));
}

/**
 * Whether the branch's copy of one file reverts one main commit, by the four
 * conditions at the top of this file. Returns the finding, or `null`.
 */
export function revertOf(file: FileVersions, commit: CommitVersions): StaleRevert | null {
	if (file.base === null || file.head === null || file.head === file.base) return null;
	const added = linesAddedBy(commit.before, commit.after);
	if (added.length === 0) return null;
	const baseLines = significantLines(file.base);
	if (!added.every((line) => baseLines.has(line))) return null;
	const headLines = significantLines(file.head);
	if (added.some((line) => headLines.has(line))) return null;
	const beforeLines = significantLines(commit.before);
	const authored = [...headLines].filter((line) => !baseLines.has(line));
	if (authored.some((line) => !beforeLines.has(line))) return null;
	return {
		path: file.path,
		sha: commit.sha,
		subject: commit.subject,
		removed: added.length,
		identical: file.head === commit.before
	};
}

/** The newest reverted commit per file, in the order the files were given. */
export function findStaleReverts(histories: FileHistory[]): StaleRevert[] {
	const findings: StaleRevert[] = [];
	for (const history of histories) {
		for (const commit of history.commits) {
			const finding = revertOf(history.file, commit);
			if (finding !== null) {
				findings.push(finding);
				break;
			}
		}
	}
	return findings;
}

/** What a reader is told, one line per file, naming the commit being undone. */
export function describeStaleReverts(findings: StaleRevert[]): string[] {
	return findings.map(
		(finding) =>
			`${finding.path}: this branch restores the copy main had before ${finding.sha.slice(0, 7)} ("${finding.subject}") and drops all ${finding.removed} line${finding.removed === 1 ? '' : 's'} that commit added${finding.identical ? ', byte for byte' : ''}. Merging would revert that work. Rebase onto main and keep main's copy of this file.`
	);
}

/**
 * The commits a branch declares it means to revert, from `Reverts: <sha>`
 * trailers in its own commit messages. Abbreviated hashes are accepted, since
 * that is how a person writes one.
 */
export function declaredReverts(messages: string): string[] {
	return [...messages.matchAll(/^\s*Reverts:\s*([0-9a-f]{7,40})\s*$/gim)].map((match) =>
		(match[1] ?? '').toLowerCase()
	);
}

/** Findings whose commit the branch has not declared, by hash prefix either way. */
export function undeclared(findings: StaleRevert[], declarations: string[]): StaleRevert[] {
	return findings.filter(
		(finding) => !declarations.some((declaration) => finding.sha.startsWith(declaration))
	);
}

/** One commit on main inside the window, with the paths it changed. */
export interface WindowCommit {
	sha: string;
	subject: string;
	paths: string[];
}

/** The git reads this needs. Injected so the rule can be tested without a repository. */
export interface RevertGit {
	mergeBase(left: string, right: string): Promise<string>;
	changedPaths(base: string, head: string): Promise<string[]>;
	window(ref: string, count: number): Promise<WindowCommit[]>;
	blob(rev: string, filePath: string): Promise<string | null>;
	branchMessages(base: string, head: string): Promise<string>;
}

/**
 * Reads only what a candidate needs: the blobs for a path are fetched after the
 * window says some commit on main touched it, and the branch's own two copies
 * are fetched once per path rather than once per commit.
 */
export async function scanForStaleReverts(
	git: RevertGit,
	base: string,
	head: string,
	commits: WindowCommit[]
): Promise<StaleRevert[]> {
	const changed = new Set(await git.changedPaths(base, head));
	const histories: FileHistory[] = [];
	for (const filePath of changed) {
		const touching = commits.filter((commit) => commit.paths.includes(filePath));
		if (touching.length === 0) continue;
		const file: FileVersions = {
			path: filePath,
			base: await git.blob(base, filePath),
			head: await git.blob(head, filePath)
		};
		if (file.base === null || file.head === null || file.base === file.head) continue;
		const versions: CommitVersions[] = [];
		for (const commit of touching) {
			versions.push({
				sha: commit.sha,
				subject: commit.subject,
				before: await git.blob(`${commit.sha}^`, filePath),
				after: await git.blob(commit.sha, filePath)
			});
		}
		histories.push({ file, commits: versions });
	}
	return findStaleReverts(histories);
}

/**
 * `git log --first-parent --name-only --format=%x00%H%x00%s` output: each commit
 * is a NUL, its hash, a NUL, its subject, then the paths it changed, one per
 * line. A NUL delimiter is used because a subject can hold anything a line can.
 * A commit with no listed paths -- a true merge, which `--name-only` summarises
 * as nothing -- yields an empty path list and matches no file.
 */
export function parseWindowLog(log: string): WindowCommit[] {
	const parts = log.split('\0').slice(1);
	const commits: WindowCommit[] = [];
	for (let index = 0; index + 1 < parts.length; index += 2) {
		const [subject, ...paths] = (parts[index + 1] ?? '').split('\n');
		commits.push({
			sha: (parts[index] ?? '').trim(),
			subject: (subject ?? '').trim(),
			paths: paths.filter(Boolean)
		});
	}
	return commits;
}

const run = promisify(execFile);

/** A `RevertGit` backed by the repository at `cwd`. */
export function repositoryGit(cwd: string): RevertGit {
	const git = async (args: string[]): Promise<string> => {
		const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
		return stdout;
	};
	return {
		mergeBase: async (left, right) => (await git(['merge-base', left, right])).trim(),
		changedPaths: async (base, head) =>
			(await git(['diff', '--name-only', `${base}..${head}`])).split('\n').filter(Boolean),
		window: async (ref, count) => {
			const log = await git([
				'log',
				'--first-parent',
				`-n${String(count)}`,
				'--name-only',
				'--format=%x00%H%x00%s',
				ref
			]);
			return parseWindowLog(log);
		},
		branchMessages: async (base, head) => await git(['log', '--format=%B', `${base}..${head}`]),
		blob: async (rev, filePath) => {
			try {
				return await git(['show', `${rev}:${filePath}`]);
			} catch {
				return null;
			}
		}
	};
}
