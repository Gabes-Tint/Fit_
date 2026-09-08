import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
	declaredReverts,
	describeStaleReverts,
	repositoryGit,
	revertWindowCommits,
	scanForStaleReverts,
	undeclared
} from './stale-revert';

/**
 * Asks whether this branch reverts recently merged work. `stale-revert.ts` has
 * the rule and the case it was written from; this resolves the two refs and
 * reports.
 *
 * The main ref is whichever of `origin/main` and `main` exists, so this reads
 * the same in a hosted checkout, in an agent's worktree and in a throwaway
 * repository built by the gate self-test. On main itself the merge base is the
 * commit under test, the branch diff is empty, and this says so and passes.
 */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const git = repositoryGit(projectRoot);

async function mainRef(): Promise<string> {
	for (const candidate of ['origin/main', 'main']) {
		try {
			await git.mergeBase(candidate, 'HEAD');
			return candidate;
		} catch {
			continue;
		}
	}
	throw new Error(
		'Neither origin/main nor main is present, so there is nothing to compare this branch against. A hosted checkout needs fetch-depth: 0.'
	);
}

const ref = await mainRef();
const base = await git.mergeBase(ref, 'HEAD');
const commits = await git.window(base, revertWindowCommits);
const found = await scanForStaleReverts(git, base, 'HEAD', commits);
const findings = undeclared(found, declaredReverts(await git.branchMessages(base, 'HEAD')));

if (findings.length === 0) {
	console.log(
		`Stale-revert check: this branch takes nothing back from the ${commits.length} most recent commits on ${ref}${found.length === 0 ? '' : `, beyond the ${found.length} file${found.length === 1 ? '' : 's'} it declares with a Reverts: trailer`}.`
	);
} else {
	for (const line of describeStaleReverts(findings)) console.error(line);
	console.error(
		`${findings.length} file${findings.length === 1 ? '' : 's'} above hold${findings.length === 1 ? 's' : ''} an older copy than ${ref}. Merging this branch would undo merged work, which every other gate reads as a deliberate deletion. If a revert is what you mean, put a "Reverts: <sha>" trailer naming that commit in one of this branch's commit messages.`
	);
	process.exitCode = 1;
}
