import { defineConfig } from 'vitest/config';
import thresholds from './quality/thresholds.json' with { type: 'json' };
import { resolveBuildVersion } from './scripts/build/bundle-measurement-version.ts';
import { previewKeepAlive } from './scripts/build/preview-keep-alive.ts';
import { DOM_FREE_CLIENT_SPECS } from './quality/dom-free-client-specs.mjs';
import {
	browserLaunchEnv,
	browserTempDir,
	browserWorkerCount
} from './scripts/quality/browser-memory.ts';
import { availableParallelism } from 'node:os';
import { mkdirSync } from 'node:fs';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

/**
 * The browser project is bounded by memory, not just by cores, and Chromium's
 * scratch space is kept off the tmpfs that `/tmp` is on most Linux desktops.
 * `scripts/quality/browser-memory.ts` has the measurements and the reasoning;
 * together these took `test:unit` from 9.29 GB to well under half that.
 */
const browserTemporaryDirectory = browserTempDir(import.meta.dirname);
mkdirSync(browserTemporaryDirectory, { recursive: true });

// DOM-free project first: Stryker's `bail: 1` + perTest coverage means the fast unit spec
// must fail before the browser project boots, or the mutant times out instead of being killed.
//
// Each project below gets its own dependency-optimizer cache dir. `ignorePatterns`
// keeps `node_modules/.vite` out of the Stryker sandbox, so every worker's vitest
// optimizes from nothing — and the projects in that worker start together and were
// writing into one directory, because the cache key does not include the project.
// Two of them then raced on the rename that publishes it and the run died with
// ENOTEMPTY before a single mutant ran. A directory each removes the collision
// rather than retrying it.
const testProjects = [
	{
		extends: './vite.config.ts',
		// Its own per-project dep-optimizer cache; see above.
		cacheDir: 'node_modules/.vite-client-node',
		test: {
			name: 'client-node',
			environment: 'jsdom',
			sequence: { groupOrder: 0 },
			setupFiles: ['./vitest-setup-client-node.ts'],
			...(process.env.FIT_MUTATION_RUN ? { pool: 'threads' as const } : {}),
			include: DOM_FREE_CLIENT_SPECS,
			exclude: ['src/lib/server/**']
		}
	},
	{
		extends: './vite.config.ts',
		// Its own per-project dep-optimizer cache; see above.
		cacheDir: 'node_modules/.vite-client',
		test: {
			name: 'client',
			// Vitest's browser pool would take `min(12, cores - 1)` contexts,
			// each with its own Chromium renderer; this bounds that by memory.
			maxWorkers: browserWorkerCount(availableParallelism()),
			sequence: { groupOrder: 1 },
			browser: {
				enabled: true,
				// `launchOptions` belongs to the provider, not the instance: an
				// instance-level one is accepted by the types and silently dropped.
				provider: playwright({
					launchOptions: {
						env: browserLaunchEnv(process.env, browserTemporaryDirectory)
					}
				}),
				instances: [{ browser: 'chromium' as const, headless: true }]
			},
			include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
			exclude: ['src/lib/server/**', ...DOM_FREE_CLIENT_SPECS]
		}
	},
	{
		extends: './vite.config.ts',
		// Its own per-project dep-optimizer cache; see above.
		cacheDir: 'node_modules/.vite-server',
		test: {
			name: 'server',
			environment: 'node',
			...(process.env.FIT_MUTATION_RUN ? { pool: 'threads' as const } : {}),
			include: [
				'src/**/*.{test,spec}.{js,ts}',
				'scripts/**/*.{test,spec}.ts',
				// The end-to-end harness lives here; its pure parts are unit-tested like any other.
				'tests/**/*.spec.ts'
			],
			exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
		}
	}
];

/**
 * Mutation testing needs thousands of cheap isolated runs; the browser project
 * gives expensive stateful ones, so the two do not belong in the same loop. The
 * DOM-free project is the mutation oracle and the browser project is left out.
 *
 * `groupOrder` above already established why: a mutant in a shared module is
 * covered by both projects, and once the fast spec fails to kill it the run
 * falls through to a Chromium boot. That boot does not fit the budget Stryker
 * derives from a per-test net time of milliseconds, so the mutant was recorded
 * as a Timeout — which Stryker credits as a kill while proving nothing. Ordering
 * the projects made the mutants the unit specs *do* catch die quickly; only
 * dropping the browser project fixes the ones they miss.
 *
 * The cost of this is real and deliberate: a mutant that only a browser spec
 * would have killed is now reported as Survived. That is the score this suite
 * always had, previously masked by timeouts counting as kills. It follows that
 * anything inside `mutate` in `stryker.config.mjs` needs a spec in
 * `DOM_FREE_CLIENT_SPECS`, or an explicit exclusion there saying why not.
 * `scripts/quality/mutation-oracle.ts` enforces that.
 *
 * `all` is spelled out for the same reason. It used to be absent, so the lookup
 * returned `undefined` and the full lane fell through to every project — which
 * put the browser back in the mutant loop for `test:mutation:full` and the
 * nightly gate, exactly the case the paragraphs above rule out.
 */
const MUTATION_PROJECTS: Record<string, readonly string[]> = {
	server: ['server'],
	client: ['client-node'],
	all: ['server', 'client-node']
};

const mutationProject = process.env.FIT_MUTATION_PROJECT;
// An unrecognized name used to fall back to "run every project", which is how a
// missing `all` key silently reinstated the browser. A mutation lane that cannot
// say which projects it means is a bug, so it fails instead of guessing.
if (mutationProject !== undefined && MUTATION_PROJECTS[mutationProject] === undefined)
	throw new Error(
		`FIT_MUTATION_PROJECT="${mutationProject}" is not one of ${Object.keys(MUTATION_PROJECTS).join(', ')}.`
	);
const selectedNames =
	mutationProject === undefined ? undefined : MUTATION_PROJECTS[mutationProject];
const selectedTestProjects =
	selectedNames === undefined
		? testProjects
		: testProjects.filter(({ test }) => selectedNames.includes(test.name));

/**
 * Extra hostnames the dev and preview servers will answer to.
 *
 * Vite refuses a request whose `Host` it does not recognize, which is what
 * stops a page on another site from driving a dev server over DNS rebinding.
 * Reaching this one from a phone means answering under a name that is not
 * `localhost` — a LAN address, or a tailnet name in front of a real
 * certificate — and that name belongs to whoever is testing, not to the
 * repository. So it is configuration rather than a committed list, for the
 * same reason `FIT_ALLOWED_ORIGINS` is.
 */
const DEV_HOSTS = (process.env.FIT_DEV_HOSTS ?? '')
	.split(',')
	.map((host) => host.trim())
	.filter((host) => host !== '');

/**
 * The version this build carries, read once here and substituted into the
 * bundle by `define` below, so the shell, the Capacitor build and
 * `/api/version` all answer with the same string. `scripts/build/app-version.ts`
 * has where it comes from; `scripts/build/bundle-measurement-version.ts` has
 * why this calls `resolveBuildVersion` rather than `readBuildVersion`
 * directly — a measurement build (`check:bundle`) substitutes a fixed-length
 * placeholder so the byte count it reports never depends on how long the
 * real git-derived version string happens to be.
 */
const build = resolveBuildVersion();

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(build.version),
		__APP_COMMIT__: JSON.stringify(build.commit)
	},
	plugins: [tailwindcss(), previewKeepAlive(), sveltekit()],
	server: { allowedHosts: DEV_HOSTS },
	preview: {
		allowedHosts: ['host.docker.internal', ...DEV_HOSTS]
	},
	test: {
		expect: { requireAssertions: true },
		// A mutation run puts one vitest inside every Stryker worker. Left alone,
		// each of those would size its pool to the whole machine and the workers
		// would fight each other into false timeouts; `stryker.config.mjs` sets
		// this flag and owns the parallelism instead.
		...(process.env.FIT_MUTATION_RUN ? { fileParallelism: false } : {}),
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'json-summary', 'html'],
			exclude: ['src/**/*.d.ts', 'src/**/*.{test,spec}.{js,ts}'],
			// Guarded by scripts/quality/thresholds.ts; perFile stops one
			// well-covered file from masking an uncovered one.
			thresholds: thresholds.coverage
		},
		projects: selectedTestProjects
	}
});
