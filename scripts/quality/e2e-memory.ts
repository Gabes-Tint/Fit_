/**
 * How much memory one end-to-end run may take, and the worker count that keeps
 * it there.
 *
 * A Playwright worker here is not a browser alone. `tests/preview-server.ts`
 * gives every worker its own production preview server and its own SQLite file,
 * so one worker is a browser *plus* a Vite preview process — which is why this
 * step costs more per worker than the vitest browser pool does, and why sizing
 * it from the core count is worse here than anywhere else in the gate.
 *
 * Playwright's default worker count is `cores / 2`. On a 32-core workstation
 * that is 16 workers, and 16 workers do not fit: measured in a transient
 * systemd scope under `fit-gates.slice` at `MemoryMax=6G`, reading cgroup v2
 * `memory.peak` for the whole process tree (`mobile-chrome`, 129 tests):
 *
 * | workers | peak                  | wall |
 * | ------- | --------------------- | ---- |
 * | 2       | 1.73 GB               | 97 s |
 * | 4       | 2.86 GB               | 59 s |
 * | 8       | 4.99 GB               | 55 s |
 * | 16      | 6.00 GB — OOM-killed  | died at 14 s |
 *
 * That is the defect in #278. The 16-worker run does not fail a test: it is
 * killed at the ceiling after 14 seconds, and Playwright reports the dead
 * workers as failures. A passing suite reports a failure whose cause is
 * memory, with nothing in the output saying so — and it does it
 * *intermittently*, because 16 workers land right on the cap rather than
 * clearly over it, so whether the run survives depends on what else is
 * resident in the shared slice.
 *
 * The ladder is linear at 0.54 GB per worker over a 0.64 GB intercept, which
 * predicts 9.3 GB at 16 — half again more than the per-step cap even with the
 * slice otherwise idle.
 *
 * The wall-clock column is the reason this is cheap. Between 4 and 8 workers
 * the suite gains 4 seconds for 2.1 GB: past a handful of workers this suite
 * is not CPU-bound, it is waiting on browsers. Bounding the count by memory
 * costs about four seconds and takes the peak from "sometimes over the cap" to
 * comfortably under it.
 *
 * The budget is an absolute number of bytes rather than anything read from the
 * cgroup at run time, for the reason `lint-memory.ts` and `browser-memory.ts`
 * both give: `fit-gates.slice` holds every gate on this host under one 18 GB
 * ceiling and several agents run gates at once, so what matters is what one
 * step adds to that shared total, not what any one process is nominally
 * allowed. Reading the imposed limit would in fact give the wrong answer here
 * — the transient scope's `memory.max` is the 6 GB per-step cap from
 * `scripts/dev/gate-slice.ts`, which is the blast radius of one runaway step,
 * not one step's fair share of a slice shared with three siblings.
 */

/**
 * What one end-to-end run may hold.
 *
 * Chosen to sit under `HEAVIEST_STEP_GIGABYTES` (3.9 GB) in
 * `scripts/dev/gate-slice.ts`, which records the largest honest peak of any
 * single gate step so the per-step cap cannot drift below it. At 8 workers
 * this suite peaked at 4.99 GB, which was above that record and quietly made
 * it untrue; a budget below it makes the record correct again rather than
 * requiring it to be raised.
 */
export const E2E_MEMORY_BUDGET_BYTES = Math.round(3.5 * 1024 ** 3);

/**
 * The run's cost before any worker starts: the Playwright process, the
 * production build `tests/e2e-build.ts` runs once for the whole suite, and the
 * reporters. Measured as the intercept of the ladder above (1.73 GB at two
 * workers, 4.99 GB at eight).
 */
export const E2E_BASE_BYTES = Math.round(0.65 * 1024 ** 3);

/**
 * Resident cost of one more worker: a browser, the preview server that worker
 * owns, and its SQLite connection. The slope of the ladder above.
 */
export const E2E_WORKER_RESIDENT_BYTES = Math.round(0.55 * 1024 ** 3);

/**
 * The count Playwright would have chosen on its own, repeated here so this
 * function can only ever bound that choice and never enlarge it. A worker
 * beyond one per two cores is not something the evidence asks for, and on a
 * small machine it would hand the suite more browsers than it has cores.
 */
export function playwrightDefaultWorkers(cores: number): number {
	return Math.ceil(cores / 2);
}

/**
 * How many end-to-end workers to run on a machine with `cores` cores: what
 * Playwright would have chosen, but never more than the budget pays for.
 *
 * One is the floor. A single worker still runs all 129 tests, slowly, and
 * slowly is the point — a contended run has to get slower rather than report a
 * failure about a change that is fine.
 */
export function e2eWorkerCount(
	cores: number,
	budgetBytes: number = E2E_MEMORY_BUDGET_BYTES
): number {
	const byCores = playwrightDefaultWorkers(cores);
	const byMemory = Math.floor((budgetBytes - E2E_BASE_BYTES) / E2E_WORKER_RESIDENT_BYTES);
	return Math.max(1, Math.min(byCores, byMemory));
}

/** What the run is predicted to hold at `workers`, in bytes. The budget is a claim about this. */
export function predictedPeakBytes(workers: number): number {
	return E2E_BASE_BYTES + workers * E2E_WORKER_RESIDENT_BYTES;
}
