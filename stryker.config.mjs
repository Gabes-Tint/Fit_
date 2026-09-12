import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { MUTATE_PATTERNS } from './quality/mutate-patterns.mjs';

const { mutation } = JSON.parse(
	readFileSync(new URL('./quality/thresholds.json', import.meta.url), 'utf8')
);

const scopeFile = process.env.FIT_MUTATION_SCOPE;
const scope =
	scopeFile === undefined
		? null
		: /** @type {{ lane: string, files: { path: string }[] }} */ (
				JSON.parse(readFileSync(scopeFile, 'utf8'))
			);
const scopedMutate = scope === null ? null : scope.files.map(({ path }) => path);

/**
 * Whether `scripts/quality/mutation-verdict.ts` is the governing rule for this
 * run, so the aggregate break below should stand down.
 *
 * The break is the legacy full-tree defense and stays exactly that. On a
 * changed lane the verdict is harder than the break on every file it judges: killed
 * only, where the break also credits a timeout; per file as well as in
 * aggregate; and no tolerance at all for a timeout or an uncovered mutant. It
 * also holds unchanged fallback files to this same 80 in their own pool.
 *
 * The single place the two part company is a file the verdict excuses because
 * the change never reached mutable code. There the break would re-impose the
 * whole-file debt the verdict just lifted, and from a pool that is often one
 * file, so the lane would still go red for a rewritten comment. Leaving it on
 * would make it, not the verdict, the rule that decides such a run.
 */
const governedByVerdict = scope?.lane === 'changed-node' || scope?.lane === 'changed-client';

// `vite.config.ts` reads this to serialize test files per worker, making `concurrency` below safe.
process.env.FIT_MUTATION_RUN = '1';

/** How much of a workstation's cores mutation testing may take. */
const LOCAL_CORE_SHARE = 0.85;

/** 1 GB per worker (vitest + Chromium); 70% of free memory leaves headroom for the host. */
const WORKER_MEMORY_BYTES = 1024 ** 3;
const MEMORY_HEADROOM = 0.7;
// Measured stable ceiling; ten causes Chromium OOM on the dev workstation.
const MAX_LOCAL_WORKERS = 9;

/** `STRYKER_CONCURRENCY` overrides; CI uses cores-1, local uses 85% of cores, both capped by memory. */
function concurrency() {
	const override = Number(process.env.STRYKER_CONCURRENCY);
	if (Number.isInteger(override) && override > 0) return override;
	const byCores = process.env.CI
		? availableParallelism() - 1
		: Math.floor(availableParallelism() * LOCAL_CORE_SHARE);
	const byMemory = Math.floor((process.availableMemory() * MEMORY_HEADROOM) / WORKER_MEMORY_BYTES);
	const stableLocalLimit = process.env.CI ? Number.POSITIVE_INFINITY : MAX_LOCAL_WORKERS;
	return Math.max(2, Math.min(byCores, byMemory, stableLocalLimit));
}

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	coverageAnalysis: 'perTest',
	mutate: scopedMutate ?? MUTATE_PATTERNS,
	ignorePatterns: [
		// An agent worktree is another checkout of this same repo, not code to
		// mutate. Stryker ignores only `node_modules` and `.git` of its own
		// accord and never reads `.gitignore`, so unlike every other tool that
		// walks this tree it has to be told: without this the sandbox copies one
		// whole source tree per open worktree, and there are usually ten.
		'.claude/**',
		// Stryker sandbox copies cause concurrent runners to race on Vite's dep-optimizer cache.
		'node_modules/.vite/**',
		// Per-project Vite caches; same race as above.
		'node_modules/.vite-*/**',
		// Multi-GB Python env + data; sandbox copy exhausts disk quota.
		'data/**',
		// The workflow/ Python subproject's local uv venv is gitignored local
		// state; its lib64 symlink makes the sandbox copy fail with EISDIR.
		'/workflow/.venv/**',
		'.security-cache/**',
		'.svelte-kit/**',
		'build/**',
		'coverage/**',
		'playwright-report/**',
		'reports/**',
		'test-results/**'
	],
	disableTypeChecks: 'src/lib/**/*.ts',
	testRunner: 'vitest',
	vitest: {
		configFile: 'vite.config.ts',
		related: true
	},
	reporters: ['clear-text', 'progress', 'html', 'json'],
	htmlReporter: {
		fileName:
			process.env.FIT_MUTATION_REPORT?.replace(/mutation\.json$/, 'mutation.html') ??
			'reports/mutation/mutation.html'
	},
	jsonReporter: {
		fileName: process.env.FIT_MUTATION_REPORT ?? 'reports/mutation/mutation.json'
	},
	// Stryker's score credits timeouts, so the wrapper re-evaluates with a strict
	// killed-only verdict on the lanes it governs; the break guards the rest.
	thresholds: {
		high: mutation.high,
		low: mutation.low,
		break: governedByVerdict ? null : mutation.break
	},
	// Incremental cache file is stored in CI, not committed.
	incremental: true,
	incrementalFile:
		process.env.FIT_MUTATION_INCREMENTAL ?? 'reports/mutation/stryker-incremental.json',
	concurrency: concurrency(),
	cleanTempDir: 'always'
};
