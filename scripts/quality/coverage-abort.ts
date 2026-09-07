/**
 * Tells a coverage run that never finished apart from a coverage run that
 * finished and fell short.
 *
 * A vitest browser session can die mid-run — a spec that clicks a container's
 * geometric centre and lands on a real link is one way, killing the iframe
 * vitest drives the browser tests through. When that happens the process
 * still exits non-zero and Istanbul still writes a coverage summary, but the
 * summary only reflects the files that got to run; every file whose spec
 * never started reports 0%. That reads exactly like "this change deleted
 * its tests", for files the change never touched.
 *
 * Vitest's own summary line — `Test Files  36 passed (90)` — already carries
 * the distinction: the number outside the parens is every file vitest
 * collected before deciding what to run, the numbers inside the parens'
 * matching categories (passed/failed/skipped/todo) are the files it actually
 * finished. When the collected total is larger than the sum of finished
 * files, the run aborted partway and the gap is exactly the files that never
 * ran — not files with no coverage.
 */

export interface TestFileSummary {
	/** Files vitest finished (passed, failed, skipped, or todo). */
	finished: number;
	/** Files vitest collected before running anything. */
	collected: number;
}

const TEST_FILES_LINE = /Test Files\s+(.+?)\s*\((\d+)\)/g;
const CATEGORY_COUNT = /(\d+)/g;

/**
 * Every `Test Files` summary line in a captured run's output. `test:coverage`
 * chains a client and a server vitest invocation, so a full run has two.
 */
export function parseTestFileSummaries(output: string): TestFileSummary[] {
	const summaries: TestFileSummary[] = [];
	for (const match of output.matchAll(TEST_FILES_LINE)) {
		const [, categories, total] = match;
		if (categories === undefined || total === undefined) continue;
		const finished = [...categories.matchAll(CATEGORY_COUNT)].reduce(
			(sum, [count]) => sum + Number(count),
			0
		);
		summaries.push({ finished, collected: Number(total) });
	}
	return summaries;
}

/** True once any summary in the run left files collected but never finished. */
export function summaryIsAborted(summary: TestFileSummary): boolean {
	return summary.finished < summary.collected;
}

/** The first summary line, if any, that proves the run aborted. */
export function findAbortedSummary(output: string): TestFileSummary | undefined {
	return parseTestFileSummaries(output).find(summaryIsAborted);
}

export function formatAbortedCoverageMessage(stepName: string, summary: TestFileSummary): string {
	const missing = summary.collected - summary.finished;
	return [
		`${stepName} ABORTED: ${summary.finished} of ${summary.collected} test files ran; ` +
			`${missing} never started.`,
		'  This is not a coverage failure. The files below did not go untested — their',
		'  specs never ran, most likely because the browser session that runs them died',
		'  partway through (a click landed on a real link, a page crashed, and so on).',
		'  Coverage numbers from this run are not meaningful and are not reported here.',
		'  Re-run the coverage step and look for what killed the browser session, not at',
		'  the per-file coverage errors this run would otherwise print.'
	].join('\n');
}
