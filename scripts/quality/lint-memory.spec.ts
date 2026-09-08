import { describe, expect, it } from 'vitest';
import {
	LINT_BASE_BYTES,
	LINT_MEMORY_BUDGET_BYTES,
	WORKER_HEAP_CAP_MB,
	WORKER_RESIDENT_BYTES,
	lintNodeOptions,
	lintWorkerCount,
	predictedPeakBytes
} from './lint-memory';

/**
 * The defect this file exists for: the worker count used to come from the core
 * count alone, so the bigger the machine the more memory a lint run took —
 * 9.3 GB on a 32-core workstation, enough to make gates unschedulable and to
 * take the whole session down when several agents ran them at once (#198).
 * Every case below fails against a `Math.floor(cores / 2)` that no budget bounds.
 */
describe('sizing a lint run to a memory budget', () => {
	const machines = [1, 2, 4, 8, 16, 32, 64, 128, 256];

	it('never asks for more workers than the budget pays for, however big the machine', () => {
		for (const cores of machines) {
			expect(predictedPeakBytes(lintWorkerCount(cores))).toBeLessThanOrEqual(
				LINT_MEMORY_BUDGET_BYTES
			);
		}
	});

	it('stops growing with the cores once memory is the binding constraint', () => {
		expect(lintWorkerCount(32)).toBe(lintWorkerCount(256));
	});

	it('still uses the cores it has when they, not memory, are the constraint', () => {
		// A budget large enough that nothing is bounded by it: half the cores again.
		const roomy = 512 * 1024 ** 3;
		expect(lintWorkerCount(8, roomy)).toBe(4);
		expect(lintWorkerCount(32, roomy)).toBe(16);
	});

	it('always runs, even where the budget buys no worker at all', () => {
		// ESLint reads 1 as "lint on the main thread", so this is a real run.
		expect(lintWorkerCount(1)).toBe(1);
		expect(lintWorkerCount(32, LINT_BASE_BYTES)).toBe(1);
		expect(lintWorkerCount(32, 0)).toBe(1);
	});

	it('is honest that a worker costs less resident memory than its heap ceiling', () => {
		// Inverting these would silently overcommit: the budget is spent in
		// resident bytes, and the cap only bounds one space inside them.
		expect(WORKER_RESIDENT_BYTES).toBeLessThan(WORKER_HEAP_CAP_MB * 1024 ** 2);
	});
});

describe('capping the heap of every isolate in the run', () => {
	it('caps old space when the caller set no options of their own', () => {
		expect(lintNodeOptions(undefined)).toBe(`--max-old-space-size=${WORKER_HEAP_CAP_MB}`);
		expect(lintNodeOptions('  ')).toBe(`--max-old-space-size=${WORKER_HEAP_CAP_MB}`);
	});

	it('keeps the caller’s other options rather than dropping them', () => {
		expect(lintNodeOptions('--enable-source-maps')).toBe(
			`--max-old-space-size=${WORKER_HEAP_CAP_MB} --enable-source-maps`
		);
	});

	it('lets an operator’s own ceiling win, since Node honours the last one', () => {
		expect(lintNodeOptions('--max-old-space-size=4096')).toBe(
			`--max-old-space-size=${WORKER_HEAP_CAP_MB} --max-old-space-size=4096`
		);
	});
});
