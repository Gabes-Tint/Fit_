import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
	BROWSER_BASE_BYTES,
	BROWSER_MEMORY_BUDGET_BYTES,
	RENDERER_RESIDENT_BYTES,
	VITEST_BROWSER_POOL_CAP,
	browserLaunchEnv,
	browserTempDir,
	browserWorkerCount,
	predictedPeakBytes
} from './browser-memory';

/**
 * The defect this file exists for has two halves, and both were sized to the
 * machine rather than to a budget (#233).
 *
 * Vitest's browser pool takes `min(12, cores - 1)` concurrent contexts, each a
 * Chromium renderer, so the browser suite cost grew with the core count —
 * 3.70 GB of renderers on a 32-core workstation.
 *
 * And Playwright launches Chromium with `--disable-dev-shm-usage`, which puts
 * its shared memory segments in `TMPDIR`. `/tmp` is a tmpfs on a stock Linux
 * desktop, so those segments were resident memory: 5.31 GB of the suite's
 * 9.29 GB peak, charged to the cgroup as `shmem`, held in unlinked files that
 * appear in no process's RSS and in no `du`.
 */
describe('sizing the browser project to a memory budget', () => {
	const machines = [1, 2, 4, 8, 16, 32, 64, 128, 256];

	it('never asks for more workers than the budget pays for, however big the machine', () => {
		for (const cores of machines) {
			expect(predictedPeakBytes(browserWorkerCount(cores))).toBeLessThanOrEqual(
				BROWSER_MEMORY_BUDGET_BYTES
			);
		}
	});

	it('stops growing with the cores once memory is the binding constraint', () => {
		const counts = machines.map((cores) => browserWorkerCount(cores));
		expect(Math.max(...counts)).toBeLessThan(VITEST_BROWSER_POOL_CAP);
		expect(browserWorkerCount(64)).toBe(browserWorkerCount(256));
	});

	it('never enlarges the pool vitest would have used on its own', () => {
		// This bounds vitest's choice; it must never talk it upwards, or a small
		// machine would be handed more renderers than it has cores to run them.
		for (const cores of machines) {
			expect(browserWorkerCount(cores)).toBeLessThanOrEqual(
				Math.max(1, Math.min(VITEST_BROWSER_POOL_CAP, cores - 1))
			);
		}
	});

	it('still runs the suite on a machine the budget cannot pay for', () => {
		// One context runs every spec, slowly. Zero runs nothing and reports no
		// verdict, which is the failure mode this whole slice is about.
		expect(browserWorkerCount(1)).toBe(1);
		expect(browserWorkerCount(32, BROWSER_BASE_BYTES)).toBe(1);
		expect(browserWorkerCount(32, 0)).toBe(1);
	});

	it('spends the budget it has rather than leaving renderers unused', () => {
		const workers = browserWorkerCount(32);
		expect(predictedPeakBytes(workers + 1)).toBeGreaterThan(BROWSER_MEMORY_BUDGET_BYTES);
		expect(RENDERER_RESIDENT_BYTES).toBeGreaterThan(0);
	});
});

describe('keeping Chromium scratch off a tmpfs', () => {
	it('overrides an inherited TMPDIR instead of deferring to it', () => {
		// Deferring reads as polite and gives back the entire win: the inherited
		// value is `/tmp` on a stock desktop, and `/tmp` being a tmpfs is the
		// defect. Every measurement of this fix is a measurement of this line.
		const environment = browserLaunchEnv({ TMPDIR: '/tmp', PATH: '/usr/bin' }, '/repo/scratch');
		expect(environment['TMPDIR']).toBe('/repo/scratch');
	});

	it('sets TMPDIR when the caller had none', () => {
		expect(browserLaunchEnv({ PATH: '/usr/bin' }, '/repo/scratch')['TMPDIR']).toBe('/repo/scratch');
	});

	it('carries the rest of the environment through to the browser', () => {
		// Playwright's `env` replaces the child's environment rather than adding
		// to it, so dropping a key here is how Chromium loses its display, its
		// proxy settings or its PATH.
		const environment = browserLaunchEnv({ PATH: '/usr/bin', HOME: '/home/x' }, '/repo/scratch');
		expect(environment).toMatchObject({ PATH: '/usr/bin', HOME: '/home/x' });
	});

	it('drops undefined values rather than passing them to the browser as "undefined"', () => {
		const environment = browserLaunchEnv({ PATH: '/usr/bin', EMPTY: undefined }, '/repo/scratch');
		expect(Object.hasOwn(environment, 'EMPTY')).toBe(false);
	});

	it('keeps the scratch directory inside the checkout, not in the system temp dir', () => {
		const directory = browserTempDir('/repo');
		expect(path.isAbsolute(directory)).toBe(true);
		expect(directory.startsWith(path.join('/repo', 'node_modules'))).toBe(true);
	});
});
