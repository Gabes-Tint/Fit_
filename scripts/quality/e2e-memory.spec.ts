import { describe, expect, it } from 'vitest';
import { MAX_PREVIEW_WORKERS } from '../../tests/e2e-workspace';
import {
	E2E_BASE_BYTES,
	E2E_MEMORY_BUDGET_BYTES,
	E2E_WORKER_RESIDENT_BYTES,
	e2eWorkerCount,
	playwrightDefaultWorkers,
	predictedPeakBytes
} from './e2e-memory';

/**
 * The failure this file exists for (#278) does not look like a memory failure.
 *
 * Playwright sized its workers to `cores / 2` and knew nothing about the
 * memory the gate step actually had. On a 32-core workstation that is 16
 * workers, each one a browser *and* a preview server, predicted at 9.3 GB
 * against a 6 GB per-step cap — so the kernel killed the run 14 seconds in and
 * Playwright reported the dead workers as test failures. The suite passes
 * 129/129 when it is given room.
 *
 * The workstation is the machine this hurts, and only because it is the big
 * one: the hosted runner has four cores, never chose more than two workers,
 * and never saw this.
 */
describe('sizing the end-to-end run to a memory budget', () => {
	const machines = [1, 2, 4, 8, 16, 32, 64, 128, 256];

	it('never asks for more workers than the budget pays for, however big the machine', () => {
		for (const cores of machines) {
			expect(predictedPeakBytes(e2eWorkerCount(cores))).toBeLessThanOrEqual(
				E2E_MEMORY_BUDGET_BYTES
			);
		}
	});

	it('is the fix for a count that was over the cap on this workstation', () => {
		// The regression itself: what Playwright chose unaided on 32 cores was
		// predicted at 9.3 GB, and the measured run was killed at the 6 GB
		// per-step ceiling. Both halves are asserted, because a budget that
		// happened to permit the old count would fix nothing.
		const unaided = playwrightDefaultWorkers(32);
		expect(unaided).toBe(16);
		expect(predictedPeakBytes(unaided)).toBeGreaterThan(6 * 1024 ** 3);
		expect(e2eWorkerCount(32)).toBeLessThan(unaided);
	});

	it('stops growing with the cores once memory is the binding constraint', () => {
		expect(e2eWorkerCount(64)).toBe(e2eWorkerCount(256));
	});

	it('leaves the hosted runner alone, where the cores are the binding constraint', () => {
		// `ubuntu-24.04` is a four-core runner with 16 GB to itself and no
		// sibling gates, so the budget must not be what decides its count. If
		// this ever inverts, CI has been made slower to fix a workstation
		// problem it does not have.
		expect(e2eWorkerCount(4)).toBe(playwrightDefaultWorkers(4));
	});

	it('never enlarges the pool Playwright would have used on its own', () => {
		for (const cores of machines) {
			expect(e2eWorkerCount(cores)).toBeLessThanOrEqual(playwrightDefaultWorkers(cores));
		}
	});

	it('still runs the suite on a machine the budget cannot pay for', () => {
		// One worker runs all 129 tests, slowly. Slowly is the whole ask of
		// #278: a contended run has to get slower, not report a failure about a
		// change that is fine. Zero workers would report no verdict at all.
		expect(e2eWorkerCount(1)).toBe(1);
		expect(e2eWorkerCount(32, E2E_BASE_BYTES)).toBe(1);
		expect(e2eWorkerCount(32, 0)).toBe(1);
	});

	it('spends the budget it has rather than leaving workers idle', () => {
		const workers = e2eWorkerCount(32);
		expect(predictedPeakBytes(workers + 1)).toBeGreaterThan(E2E_MEMORY_BUDGET_BYTES);
		expect(E2E_WORKER_RESIDENT_BYTES).toBeGreaterThan(0);
	});

	it('stays inside the block of preview ports and databases reserved for workers', () => {
		// Every worker takes a port and a SQLite file from a fixed block
		// (`tests/e2e-workspace.ts`); a count past it throws at fixture setup.
		for (const cores of machines) {
			expect(e2eWorkerCount(cores)).toBeLessThanOrEqual(MAX_PREVIEW_WORKERS);
		}
	});
});
