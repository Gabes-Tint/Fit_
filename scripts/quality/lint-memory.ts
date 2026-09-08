/**
 * How much memory one `bun run lint` may take, and the worker count and heap
 * ceiling that keep it there.
 *
 * `eslint.config.js` lints with type information, and ESLint's `--concurrency`
 * starts worker *threads* — each with its own V8 isolate. So every worker
 * builds and holds its own TypeScript program over the whole project and
 * shares none of it: a lint run costs a fixed base plus one program per worker.
 *
 * Sizing that count from the core count alone makes the biggest machine the
 * one most likely to die, which is why this workstation kept falling over
 * while hosted runners never noticed (#198). Measured here on 32 cores against
 * cgroup `memory.peak` for the whole process tree:
 *
 * | workers | old-space cap | peak    | wall |
 * | ------- | ------------- | ------- | ---- |
 * | 4       | none          | 5.84 GB | 39 s |
 * | 2       | none          | 3.28 GB |      |
 * | 2       | 1 GB          | 2.39 GB | 72 s |
 *
 * Two things follow. The count has to be bounded by memory as well as by
 * cores — the shape `stryker.config.mjs` already uses for its own workers. And
 * the heap needs a ceiling: left alone, V8 sizes old space to the whole
 * machine, so a worker grows past 1.5 GB holding a program whose live set fits
 * in well under a gigabyte, simply because nothing ever makes it collect. The
 * cap costs no measurable wall time and takes a third off the peak.
 *
 * The budget is an absolute number of bytes rather than a share of free
 * memory, deliberately: `fit-gates.slice` holds every gate on this host under
 * one ceiling and several agents run gates at once, so what matters is what
 * one lint step adds to that shared total — not how much of the machine
 * happens to be idle at the moment it starts.
 */

/** What one lint step may hold. Chosen by #198; the rest of this file serves it. */
export const LINT_MEMORY_BUDGET_BYTES = 3 * 1024 ** 3;

/**
 * The run's cost before any worker starts: the ESLint process itself, its
 * config resolution and the report it accumulates. Measured as the intercept
 * of the two uncapped runs above (5.84 GB at four workers, 3.28 GB at two).
 */
export const LINT_BASE_BYTES = Math.round(0.95 * 1024 ** 3);

/**
 * Resident cost of one worker at the heap cap below — what a worker adds to
 * the run, not what its heap is allowed to reach. The two differ because the
 * cap bounds old space while this counts the whole thread, and because a
 * worker collects rather than growing into the headroom the cap leaves it.
 */
export const WORKER_RESIDENT_BYTES = Math.round(0.75 * 1024 ** 3);

/**
 * Old-space ceiling for every isolate in the lint run. Comfortably above the
 * live set — 768 MB also completes — because a worker that cannot collect its
 * way under the cap dies with a fatal heap error, and a gate step killed that
 * way reports a crash: no verdict about the change at all, which is the
 * failure #191 was about.
 */
export const WORKER_HEAP_CAP_MB = 1024;

/**
 * How many ESLint workers to ask for on a machine with `cores` cores: half the
 * cores, as ESLint's own `auto` would, but never more than the budget pays for.
 *
 * One is the floor rather than zero because ESLint reads a concurrency of 1 as
 * "lint on the main thread", which is a valid run and the right one on a small
 * machine.
 */
export function lintWorkerCount(
	cores: number,
	budgetBytes: number = LINT_MEMORY_BUDGET_BYTES
): number {
	const byCores = Math.floor(cores / 2);
	const byMemory = Math.floor((budgetBytes - LINT_BASE_BYTES) / WORKER_RESIDENT_BYTES);
	return Math.max(1, Math.min(byCores, byMemory));
}

/** What the run is predicted to hold at `workers`, in bytes. The budget is a claim about this. */
export function predictedPeakBytes(workers: number): number {
	return LINT_BASE_BYTES + workers * WORKER_RESIDENT_BYTES;
}

/**
 * `NODE_OPTIONS` for the ESLint child, preserving whatever the caller already
 * set rather than replacing it. Ours goes first so that an operator's own
 * `--max-old-space-size` still wins — Node honours the last occurrence, and
 * someone passing one by hand is deliberately overriding this file.
 */
export function lintNodeOptions(existing: string | undefined): string {
	const ours = `--max-old-space-size=${WORKER_HEAP_CAP_MB}`;
	const before = existing?.trim() ?? '';
	return before === '' ? ours : `${ours} ${before}`;
}
