import { describe, expect, it } from 'vitest';
import { ALLOW_RED_MAIN_VARIABLE, CI_POLL_MS, CI_WAIT_MS, mainCiGate } from './main-ci-gate';
import type { CiRun, MainCiGateOptions } from './main-ci-gate';

/**
 * The wait driven by an injected clock rather than a real one, matching
 * `release-version.spec.ts`: the behavior under test is "how long does it
 * keep asking", not how long the test itself takes.
 */

interface Harness {
	waits: number[];
	logs: string[];
	clock: number;
}

function harness(runs: CiRun[][]): { state: Harness; options: MainCiGateOptions } {
	const remaining = [...runs];
	const state: Harness = { waits: [], logs: [], clock: 0 };
	return {
		state,
		options: {
			fetchRuns: () => Promise.resolve(remaining.shift() ?? (runs.at(-1) as CiRun[])),
			now: () => state.clock,
			wait: (milliseconds) => {
				state.waits.push(milliseconds);
				state.clock += milliseconds;
				return Promise.resolve();
			},
			log: (message) => state.logs.push(message)
		}
	};
}

const PUSH_SUCCESS: CiRun = {
	status: 'completed',
	conclusion: 'success',
	url: 'https://ci/1',
	event: 'push',
	headBranch: 'main'
};
const PUSH_FAILURE: CiRun = {
	status: 'completed',
	conclusion: 'failure',
	url: 'https://ci/2',
	event: 'push',
	headBranch: 'main'
};
const PUSH_IN_PROGRESS: CiRun = {
	status: 'in_progress',
	conclusion: null,
	url: 'https://ci/3',
	event: 'push',
	headBranch: 'main'
};
const MERGE_GROUP_SUCCESS: CiRun = {
	status: 'completed',
	conclusion: 'success',
	url: 'https://ci/4',
	event: 'merge_group',
	headBranch: 'gh-readonly-queue/main/pr-42-abc123'
};
const MERGE_GROUP_FAILURE: CiRun = {
	status: 'completed',
	conclusion: 'failure',
	url: 'https://ci/5',
	event: 'merge_group',
	headBranch: 'gh-readonly-queue/main/pr-42-abc123'
};
const PUSH_SUCCESS_OTHER_BRANCH: CiRun = {
	status: 'completed',
	conclusion: 'success',
	url: 'https://ci/6',
	event: 'push',
	headBranch: 'feature-x'
};
const PUSH_FAILURE_NEWER: CiRun = {
	status: 'completed',
	conclusion: 'failure',
	url: 'https://ci/7',
	event: 'push',
	headBranch: 'main'
};
const PUSH_SUCCESS_OLDER: CiRun = {
	status: 'completed',
	conclusion: 'success',
	url: 'https://ci/8',
	event: 'push',
	headBranch: 'main'
};

describe('the gate on deploying a commit whose CI on main might not be green', () => {
	it('proceeds when the push run for this commit succeeded', async () => {
		const { state, options } = harness([[PUSH_SUCCESS]]);
		await expect(mainCiGate(options)).resolves.toBeUndefined();
		expect(state.waits).toEqual([]);
	});

	it('refuses with the run URL when the push run for this commit failed and no merge-group run exists', async () => {
		const { options } = harness([[PUSH_FAILURE]]);
		await expect(mainCiGate(options)).rejects.toThrow(/concluded "failure".*https:\/\/ci\/2/);
	});

	it('refuses when no run exists for this commit, without waiting', async () => {
		const { state, options } = harness([[]]);
		await expect(mainCiGate(options)).rejects.toThrow(/No ci\.yml run found/);
		expect(state.waits).toEqual([]);
	});

	it('waits while the push run is in progress, then proceeds once it succeeds', async () => {
		const { state, options } = harness([[PUSH_IN_PROGRESS], [PUSH_IN_PROGRESS], [PUSH_SUCCESS]]);
		await expect(mainCiGate(options)).resolves.toBeUndefined();
		expect(state.waits).toEqual([CI_POLL_MS, CI_POLL_MS]);
	});

	it('gives up after the ceiling and refuses, naming the run URL', async () => {
		const { state, options } = harness([[PUSH_IN_PROGRESS]]);
		await expect(mainCiGate(options)).rejects.toThrow(/still running after 120s.*https:\/\/ci\/3/);
		expect(state.clock).toBe(CI_WAIT_MS);
	});

	it('honours a shorter deadline than the default', async () => {
		const { state, options } = harness([[PUSH_IN_PROGRESS]]);
		await expect(mainCiGate({ ...options, timeoutMs: 10, pollMs: 5 })).rejects.toThrow(
			/still running after 0s/
		);
		expect(state.waits).toEqual([5, 5]);
	});

	it('proceeds with a loud warning when the escape hatch is set, without fetching', async () => {
		const { state, options } = harness([[PUSH_FAILURE]]);
		let fetched = false;
		await expect(
			mainCiGate({
				...options,
				allowRedMain: true,
				fetchRuns: () => {
					fetched = true;
					return options.fetchRuns();
				}
			})
		).resolves.toBeUndefined();
		expect(fetched).toBe(false);
		expect(state.logs).toEqual([
			`${ALLOW_RED_MAIN_VARIABLE}=1: skipping the check that main's CI is green for this ` +
				'commit. This can ship a release nothing has verified.'
		]);
	});

	describe('the merge queue verdict', () => {
		it('proceeds on a green push run even when the merge-group run failed', async () => {
			const { state, options } = harness([[PUSH_SUCCESS, MERGE_GROUP_FAILURE]]);
			await expect(mainCiGate(options)).resolves.toBeUndefined();
			expect(state.logs).toEqual([]);
		});

		it('accepts a red push run when the merge-group run for the same commit is green, with a note naming both', async () => {
			const { state, options } = harness([[PUSH_FAILURE, MERGE_GROUP_SUCCESS]]);
			await expect(mainCiGate(options)).resolves.toBeUndefined();
			expect(state.logs).toEqual([
				expect.stringMatching(
					/push run concluded "failure": https:\/\/ci\/2.*merge queue already verified.*https:\/\/ci\/4/s
				)
			]);
		});

		it('refuses when both the push run and the merge-group run failed', async () => {
			const { options } = harness([[PUSH_FAILURE, MERGE_GROUP_FAILURE]]);
			await expect(mainCiGate(options)).rejects.toThrow(
				/push run concluded "failure": https:\/\/ci\/2.*merge-group run concluded "failure": https:\/\/ci\/5/s
			);
		});

		it('accepts a green merge-group run when no push run exists at all', async () => {
			const { state, options } = harness([[MERGE_GROUP_SUCCESS]]);
			await expect(mainCiGate(options)).resolves.toBeUndefined();
			expect(state.logs).toEqual([
				expect.stringMatching(/no push run on main for this commit.*https:\/\/ci\/4/s)
			]);
		});

		it('refuses a green push run for this SHA found on another branch, as if no run exists, with the merge-group hint', async () => {
			const { state, options } = harness([[PUSH_SUCCESS_OTHER_BRANCH]]);
			await expect(mainCiGate(options)).rejects.toThrow(
				/No ci\.yml run found on main.*merge-group run for this exact commit also counts/s
			);
			expect(state.waits).toEqual([]);
		});

		it('refuses a no-runs-at-all case without the merge-group hint', async () => {
			const { options } = harness([[]]);
			await expect(mainCiGate(options)).rejects.toThrow(
				new Error('No ci.yml run found on main for this commit; refusing to deploy it.')
			);
		});

		it('picks the newest push run: an older green push does not override a newer red one', async () => {
			const { options } = harness([[PUSH_FAILURE_NEWER, PUSH_SUCCESS_OLDER]]);
			await expect(mainCiGate(options)).rejects.toThrow(
				/push run concluded "failure": https:\/\/ci\/7/
			);
		});
	});
});
