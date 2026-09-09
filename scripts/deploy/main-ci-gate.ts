import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { capture } from '../security/shared';

const execFileAsync = promisify(execFile);

/**
 * Refuses to ship a commit whose own CI is not green.
 *
 * The incident this exists for: PR #120 and PR #121 were each green on their
 * own branch, based on the same commit, and merged back to back. Main's CI
 * for the merged result then failed `check:bundle` by 8 bytes (run
 * 33941127559) — a state neither PR's green run ever tested — and that
 * failing commit was deployed anyway as v0.0.10, because nothing asked main.
 * A PR's checks answer for its branch; only a run keyed to the exact commit
 * that landed answers for what is about to ship.
 *
 * Since main started landing through a merge queue, that run can come from
 * either of two places. Every commit that lands is first built and tested
 * by a `merge_group` run against `gh-readonly-queue/main/pr-<n>-<sha>`,
 * whose head SHA is the exact commit that then lands unchanged. Main's own
 * `push` run re-executes that same commit, and — because it enforces the
 * flake policy just as strictly — can go red on a retried flake the queue
 * run did not hit, blocking a deploy of a commit the queue already proved
 * green. So this gate accepts either: a successful `push` run on `main` for
 * the commit, or a successful `merge_group` run on a `gh-readonly-queue/main/…`
 * branch whose head SHA is that commit — `gh run list --commit` matches on
 * SHA alone and can also return a run of the same commit on some other
 * branch, so the branch is checked per event rather than dropped. A failed
 * (or missing) push run beside a successful merge-group run for the same
 * commit is accepted, with a note naming both runs. Neither green is still
 * refused — the flake policy is not weakened, only which run may satisfy it
 * is widened.
 *
 * The wait reuses `release-version.ts`'s ceiling: about two minutes is long
 * enough for a run already `in_progress` to finish, short enough not to turn
 * a broken check into an indefinite hang.
 */

/** Same ceiling as `TAG_WAIT_MS` in `release-version.ts`, for the same reason. */
export const CI_WAIT_MS = 120_000;

/** Same cadence as `TAG_POLL_MS` in `release-version.ts`. */
export const CI_POLL_MS = 5_000;

/** The environment variable that bypasses this check, for the day it is itself broken. */
export const ALLOW_RED_MAIN_VARIABLE = 'FIT_DEPLOY_ALLOW_RED_MAIN';

/** The one workflow this check looks for a run of. */
const CI_WORKFLOW = 'ci.yml';

/** The branch a deploy's commit must have landed on. */
const CI_BRANCH = 'main';

/** Main's own re-run of the commit that just landed. */
const PUSH_EVENT = 'push';

/** The merge queue's run of the same commit, before it landed. */
const MERGE_GROUP_EVENT = 'merge_group';

/** The prefix every merge-group run's head branch carries, per GitHub's queue naming. */
const MERGE_QUEUE_BRANCH_PREFIX = `gh-readonly-queue/${CI_BRANCH}/`;

/** A hint appended to every refusal, so the reason a green merge-group run did not cover it is visible. */
const MERGE_GROUP_HINT = 'A successful merge-group run for this exact commit also counts.';

export interface CiRun {
	status: string;
	conclusion: string | null;
	url: string;
	event: string;
	headBranch: string;
}

export interface MainCiGateOptions {
	/** The runs GitHub reports for this commit, across events, newest first. */
	fetchRuns: () => Promise<CiRun[]>;
	/** Milliseconds since some fixed point; injected so a spec need not sleep. */
	now: () => number;
	wait: (milliseconds: number) => Promise<void>;
	log: (message: string) => void;
	/** `FIT_DEPLOY_ALLOW_RED_MAIN=1` was set: proceed regardless, loudly. */
	allowRedMain?: boolean;
	timeoutMs?: number;
	pollMs?: number;
}

function isGreen(run: CiRun | undefined): boolean {
	return run !== undefined && run.status === 'completed' && run.conclusion === 'success';
}

function isPending(run: CiRun | undefined): boolean {
	return run !== undefined && run.status !== 'completed';
}

/**
 * Resolves when it is safe to deploy, rejects with the reason otherwise.
 *
 * No run yet is refused outright rather than waited on: a deploy that runs
 * moments after a merge and finds nothing has arrived too early to be sure
 * CI was even triggered, and waiting on a run that may never exist is the
 * same failure mode this check is meant to prevent. A run already under way
 * is worth waiting on, up to the ceiling, because it is expected to finish.
 */
export async function mainCiGate(options: MainCiGateOptions): Promise<void> {
	if (options.allowRedMain === true) {
		options.log(
			`${ALLOW_RED_MAIN_VARIABLE}=1: skipping the check that main's CI is green for this ` +
				'commit. This can ship a release nothing has verified.'
		);
		return;
	}

	const timeout = options.timeoutMs ?? CI_WAIT_MS;
	const poll = options.pollMs ?? CI_POLL_MS;
	const deadline = options.now() + timeout;

	for (;;) {
		const runs = await options.fetchRuns();
		// Newest first: the first match for each event is that event's latest run, so a
		// later red push run overrides an earlier green one rather than being missed.
		const pushRun = runs.find((run) => run.event === PUSH_EVENT && run.headBranch === CI_BRANCH);
		const mergeGroupRun = runs.find(
			(run) =>
				run.event === MERGE_GROUP_EVENT && run.headBranch.startsWith(MERGE_QUEUE_BRANCH_PREFIX)
		);

		if (pushRun === undefined && mergeGroupRun === undefined) {
			const hint = runs.length > 0 ? ` ${MERGE_GROUP_HINT}` : '';
			throw new Error(
				`No ${CI_WORKFLOW} run found on ${CI_BRANCH} for this commit; refusing to deploy it.` + hint
			);
		}

		if (isGreen(pushRun)) return;

		if (mergeGroupRun !== undefined && isGreen(mergeGroupRun)) {
			const pushNote =
				pushRun === undefined
					? 'no push run on main for this commit'
					: `push run concluded "${pushRun.conclusion}": ${pushRun.url}`;
			options.log(
				`CI on ${CI_BRANCH} for this commit is not green from its push run (${pushNote}), ` +
					`but the merge queue already verified this exact commit: ${mergeGroupRun.url}`
			);
			return;
		}

		if (!isPending(pushRun) && !isPending(mergeGroupRun)) {
			const parts: string[] = [];
			if (pushRun !== undefined) {
				parts.push(`push run concluded "${pushRun.conclusion}": ${pushRun.url}`);
			}
			if (mergeGroupRun !== undefined) {
				parts.push(`merge-group run concluded "${mergeGroupRun.conclusion}": ${mergeGroupRun.url}`);
			}
			throw new Error(
				`CI on ${CI_BRANCH} for this commit concluded without success (${parts.join('; ')}); ` +
					`refusing to deploy it. ${MERGE_GROUP_HINT}`
			);
		}

		if (options.now() >= deadline) {
			const pending = [pushRun, mergeGroupRun].filter(
				(run): run is CiRun => run !== undefined && isPending(run)
			);
			const urls = pending.map((run) => `${run.event} run ${run.url}`).join(', ');
			throw new Error(
				`CI on ${CI_BRANCH} for this commit is still running after ` +
					`${Math.round(timeout / 1000)}s; refusing to deploy it: ${urls}`
			);
		}
		await options.wait(poll);
	}
}

async function assertGhAvailable(): Promise<void> {
	try {
		await execFileAsync('gh', ['--version']);
	} catch {
		throw new Error(
			'the deploy CI check needs the gh CLI on PATH; install it rather than skip the check'
		);
	}
}

async function fetchMainCiRuns(commit: string): Promise<CiRun[]> {
	const output = await capture('gh', [
		'run',
		'list',
		'--workflow',
		CI_WORKFLOW,
		'--commit',
		commit,
		'--json',
		'status,conclusion,url,event,headBranch'
	]);
	return JSON.parse(output === '' ? '[]' : output) as CiRun[];
}

/** The same thing, wired to `gh` and the clock. */
export async function assertMainCiGreen(commit: string): Promise<void> {
	const allowRedMain = process.env[ALLOW_RED_MAIN_VARIABLE] === '1';
	if (!allowRedMain) await assertGhAvailable();
	await mainCiGate({
		fetchRuns: () => fetchMainCiRuns(commit),
		now: () => Date.now(),
		wait: (milliseconds) => delay(milliseconds),
		log: (message) => console.log(message),
		allowRedMain
	});
}
