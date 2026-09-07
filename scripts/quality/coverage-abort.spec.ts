import { describe, expect, it } from 'vitest';
import {
	findAbortedSummary,
	formatAbortedCoverageMessage,
	parseTestFileSummaries,
	summaryIsAborted
} from './coverage-abort';

const completeRun = `
 Test Files  90 passed (90)
      Tests  612 passed (612)
`;

const belowThresholdRun = `
 Test Files  90 passed (90)
      Tests  612 passed (612)

ERROR: Coverage for functions (72%) does not meet global threshold (80%) for src/lib/components/exercise/LibrarySheet.svelte
`;

const abortedRun = `
 Test Files  36 passed (90)
      Tests  240 passed (240)
Error: Failed to run the test .../SideNav.svelte.spec.ts.
Caused by: Cannot connect to the iframe... Received URL: http://localhost:63315/exercise
`;

const abortedWithFailures = `
 Test Files  2 failed | 34 passed (90)
      Tests  238 passed (238)
`;

describe('parseTestFileSummaries', () => {
	it('reads finished and collected counts off the vitest summary line', () => {
		expect(parseTestFileSummaries(completeRun)).toStrictEqual([{ finished: 90, collected: 90 }]);
	});

	it('sums every category (failed, passed, skipped) into the finished count', () => {
		expect(parseTestFileSummaries(abortedWithFailures)).toStrictEqual([
			{ finished: 36, collected: 90 }
		]);
	});

	it('finds one summary per chained vitest invocation', () => {
		const chained = `${completeRun}\n${abortedRun}`;
		expect(parseTestFileSummaries(chained)).toStrictEqual([
			{ finished: 90, collected: 90 },
			{ finished: 36, collected: 90 }
		]);
	});

	it('returns nothing for output with no Test Files line', () => {
		expect(parseTestFileSummaries('some unrelated failure')).toStrictEqual([]);
	});
});

describe('summaryIsAborted', () => {
	it('is false when every collected file finished', () => {
		expect(summaryIsAborted({ finished: 90, collected: 90 })).toBe(false);
	});

	it('is true when files were collected but never finished', () => {
		expect(summaryIsAborted({ finished: 36, collected: 90 })).toBe(true);
	});
});

describe('findAbortedSummary', () => {
	it('reports the aborted run distinctly from a complete run under threshold', () => {
		expect(findAbortedSummary(belowThresholdRun)).toBeUndefined();
		expect(findAbortedSummary(abortedRun)).toStrictEqual({ finished: 36, collected: 90 });
	});

	it('catches an abort even when some finished files failed', () => {
		expect(findAbortedSummary(abortedWithFailures)).toStrictEqual({ finished: 36, collected: 90 });
	});
});

describe('formatAbortedCoverageMessage', () => {
	it('names the step, the finished/collected split, and says coverage numbers do not apply', () => {
		const message = formatAbortedCoverageMessage('test:coverage', { finished: 36, collected: 90 });
		expect(message).toContain('test:coverage ABORTED');
		expect(message).toContain('36 of 90 test files ran');
		expect(message).toContain('54 never started');
		expect(message).toContain('not a coverage failure');
	});
});
