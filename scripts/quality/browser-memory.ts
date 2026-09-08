/**
 * How much memory the `client` vitest project may take, and the worker count
 * and scratch directory that keep it there.
 *
 * The browser project runs every spec that mounts a component in a real
 * headless Chromium. Vitest's browser pool gives each concurrent test file its
 * own browser *context*, and Chromium backs a context with its own renderer
 * process — so the run costs a fixed base plus one renderer per worker, and
 * that count comes from `Math.min(12, cores - 1)` inside vitest's own pool.
 * Sizing from cores alone is what made this workstation the machine most
 * likely to die while hosted runners never noticed, which is the same defect
 * `lint-memory.ts` describes for ESLint (#198, #233).
 *
 * Measured here on 32 cores against cgroup `memory.peak` for the whole process
 * tree, with the scratch directory below already in place:
 *
 * | workers | peak    | wall |
 * | ------- | ------- | ---- |
 * | 12      | 4.02 GB | 20 s |
 * | 6       | 2.64 GB | 20 s |
 * | 4       | 2.33 GB | 22 s |
 * | 2       | 1.66 GB | 33 s |
 *
 * Two things follow, and the second is the larger half of the win.
 *
 * The count has to be bounded by memory as well as by cores — the shape
 * `stryker.config.mjs` and `lint-memory.ts` already use.
 *
 * And Chromium's scratch space has to live on a real filesystem. Playwright
 * launches Chromium with `--disable-dev-shm-usage`, which moves its shared
 * memory segments out of `/dev/shm` and into `TMPDIR`. On this workstation —
 * and on any Arch or systemd default — `/tmp` is a **tmpfs**, so those
 * segments are not files at all, they are RAM, charged to the run's cgroup as
 * `shmem` and not reclaimable under pressure. That accounted for 5.3 GB of the
 * suite's 9.3 GB peak: `test:unit` wrote ~5 GB into `/tmp` and freed it again,
 * and nothing in the process tree's RSS ever showed it. Pointing Chromium at a
 * directory on disk took the `client` project's `shmem` from 3.89 GB to zero
 * with no change in wall time and no change to what the tests do.
 *
 * Deliberately *not* here: a `--js-flags=--max-old-space-size` cap on the
 * renderers. It is the browser-side analogue of the heap cap that won #198, so
 * it was measured rather than assumed — 2.33 GB against 2.28 GB at four
 * workers, and 2.64 GB against 2.69 GB at six. That is noise, so the flag
 * would be a constraint the evidence does not ask for. Renderer heaps are not
 * where this project's memory goes.
 *
 * The budget is an absolute number of bytes rather than a share of free
 * memory, for the reason `lint-memory.ts` gives: `fit-gates.slice` holds every
 * gate on this host under one ceiling and several agents run gates at once, so
 * what matters is what one step adds to that shared total, not how much of the
 * machine happens to be idle when it starts.
 */
import path from 'node:path';

/** What the browser project may hold. The rest of this file serves this number. */
export const BROWSER_MEMORY_BUDGET_BYTES = Math.round(2.5 * 1024 ** 3);

/**
 * The run's cost before any renderer starts: the vitest process and its Vite
 * module graph, the Chromium browser process, and its GPU and network utility
 * children. Measured as the intercept of the ladder above (1.66 GB at two
 * workers, 4.02 GB at twelve).
 */
export const BROWSER_BASE_BYTES = Math.round(1.0 * 1024 ** 3);

/** Resident cost of one more concurrent test file: a browser context and its renderer. */
export const RENDERER_RESIDENT_BYTES = Math.round(0.25 * 1024 ** 3);

/**
 * The ceiling vitest's own browser pool applies (`Math.min(12, cores - 1)`).
 * Repeated here so the count this module returns is never *more* than vitest
 * would have used on its own — this bounds the pool, it does not enlarge it.
 */
export const VITEST_BROWSER_POOL_CAP = 12;

/**
 * How many concurrent browser contexts to allow on a machine with `cores`
 * cores: what vitest would have chosen, but never more than the budget pays
 * for. One is the floor — a single context still runs every spec, slowly.
 */
export function browserWorkerCount(
	cores: number,
	budgetBytes: number = BROWSER_MEMORY_BUDGET_BYTES
): number {
	const byCores = Math.min(VITEST_BROWSER_POOL_CAP, cores - 1);
	const byMemory = Math.floor((budgetBytes - BROWSER_BASE_BYTES) / RENDERER_RESIDENT_BYTES);
	return Math.max(1, Math.min(byCores, byMemory));
}

/** What the run is predicted to hold at `workers`, in bytes. The budget is a claim about this. */
export function predictedPeakBytes(workers: number): number {
	return BROWSER_BASE_BYTES + workers * RENDERER_RESIDENT_BYTES;
}

/**
 * Where Chromium keeps its shared memory segments and profile scratch.
 *
 * Under `node_modules` because that is the one directory guaranteed to exist,
 * to be on the same real filesystem as the checkout, and to be ignored by git
 * and by every tool that walks the tree. `TMPDIR` is what Chromium reads once
 * Playwright has passed `--disable-dev-shm-usage`, so this is the whole
 * mechanism — there is no Chromium flag to set instead.
 */
export function browserTempDir(projectRoot: string): string {
	return path.join(projectRoot, 'node_modules', '.tmp-browser');
}

/**
 * The environment for the Chromium child: the caller's, with `TMPDIR` pointed
 * at a real filesystem.
 *
 * It overrides an inherited `TMPDIR` rather than deferring to one. Deferring
 * reads as the polite thing to do and quietly gives back the whole win: the
 * inherited value is `/tmp` on a stock desktop, and `/tmp` being a tmpfs is
 * the entire defect. This is not a preference about where scratch files go,
 * it is a requirement that they not be resident memory, so it is not the
 * caller's to express by accident.
 */
export function browserLaunchEnv(
	existing: NodeJS.ProcessEnv,
	temporaryDirectory: string
): Record<string, string> {
	const entries = Object.entries(existing).filter(
		(entry): entry is [string, string] => entry[1] !== undefined
	);
	return { ...Object.fromEntries(entries), TMPDIR: temporaryDirectory };
}
