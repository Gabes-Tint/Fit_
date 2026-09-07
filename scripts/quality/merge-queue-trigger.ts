/**
 * One rule, kept out of `ci-contract.ts` because it guards a failure mode none
 * of the checks there can see: the workflow that reports the branch's required
 * check must also answer `merge_group` events.
 *
 * A merge queue does not test the pull request. It builds `main` plus every
 * queued pull request onto a `gh-readonly-queue/...` branch and asks for checks
 * on that combined tree -- which is the whole point, because two pull requests
 * can each be green alone and red together. Those requests arrive as
 * `merge_group` events. A workflow that does not listen for them reports
 * nothing, the required check stays pending forever, and every merge blocks.
 * There is no partial failure and no warning: the queue simply stops.
 *
 * Deleting the trigger is a one-line edit that reads like tidying up an event
 * list, and nothing else in this repository would notice, so this asserts it.
 */

/** The single required status check on `main` (branch protection contexts). */
export const requiredCheckName = 'Quality and security';

/** The trigger the merge queue's combined branch needs answered. */
export const mergeQueueTrigger = 'merge_group';

/**
 * The top-level keys of a workflow's `on:` mapping, in file order. Handles the
 * block form used here and the inline-sequence form (`on: [push, ...]`) so a
 * reformat cannot make this quietly return nothing.
 */
export function workflowTriggers(source: string): string[] {
	const inline = /^on:\s*\[([^\]]*)\]\s*$/m.exec(source);
	if (inline !== null) {
		return (inline[1] ?? '')
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}
	const start = /^on:\s*$/m.exec(source);
	if (start === null) return [];
	const body = source.slice((start.index ?? 0) + start[0].length);
	const end = /^\S/m.exec(body);
	const block = end === null ? body : body.slice(0, end.index);
	return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1] ?? '');
}

/** Whether this workflow declares the job that reports the required check. */
export function declaresRequiredCheck(source: string, checkName = requiredCheckName): boolean {
	const escaped = checkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^ {4}name: ${escaped}\\s*$`, 'm').test(source);
}

/**
 * Contract failures for one workflow file. Both are about the same guarantee:
 * this file answers the merge queue for the check the branch requires. Losing
 * the job would move that check somewhere this contract does not read; losing
 * the trigger would leave the queue unanswered.
 */
export function mergeQueueFailures(source: string, workflowPath: string): string[] {
	if (!declaresRequiredCheck(source)) {
		return [
			`${workflowPath} no longer declares the required check "${requiredCheckName}", so nothing here proves the merge queue's combined branch is gated.`
		];
	}
	if (workflowTriggers(source).includes(mergeQueueTrigger)) return [];
	return [
		`${workflowPath} reports the required check "${requiredCheckName}" but has no \`${mergeQueueTrigger}:\` trigger, so the merge queue's combined branch would never run the gates and no pull request could merge.`
	];
}
