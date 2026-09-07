import { defineConfig } from 'vitest/config';
import thresholds from './quality/thresholds.json' with { type: 'json' };
import { readBuildVersion } from './scripts/build/app-version.ts';
import { previewKeepAlive } from './scripts/build/preview-keep-alive.ts';
import { DOM_FREE_CLIENT_SPECS } from './quality/dom-free-client-specs.mjs';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

// DOM-free project first: Stryker's `bail: 1` + perTest coverage means the fast unit spec
// must fail before the browser project boots, or the mutant times out instead of being killed.
const testProjects = [
	{
		extends: './vite.config.ts',
		// Per-project cache dir: concurrent vitest projects in one Stryker worker would otherwise race on rename.
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
		// Its own dependency-optimizer cache, per project.
		//
		// `ignorePatterns` keeps `node_modules/.vite` out of the Stryker sandbox, so
		// every worker's vitest optimizes from nothing — and the projects in that
		// worker start together and were writing into one directory, because the
		// cache key does not include the project. Two of them then raced on the
		// rename that publishes it and the run died with ENOTEMPTY before a single
		// mutant ran. A directory each removes the collision rather than retrying it.
		cacheDir: 'node_modules/.vite-client',
		test: {
			name: 'client',
			sequence: { groupOrder: 1 },
			browser: {
				enabled: true,
				provider: playwright(),
				instances: [{ browser: 'chromium' as const, headless: true }]
			},
			include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
			exclude: ['src/lib/server/**', ...DOM_FREE_CLIENT_SPECS]
		}
	},
	{
		extends: './vite.config.ts',
		// Its own dependency-optimizer cache, per project.
		//
		// `ignorePatterns` keeps `node_modules/.vite` out of the Stryker sandbox, so
		// every worker's vitest optimizes from nothing — and the projects in that
		// worker start together and were writing into one directory, because the
		// cache key does not include the project. Two of them then raced on the
		// rename that publishes it and the run died with ENOTEMPTY before a single
		// mutant ran. A directory each removes the collision rather than retrying it.
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
 * has where it comes from.
 */
const build = readBuildVersion();

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(build.version),
		__APP_COMMIT__: JSON.stringify(build.commit)
	},
	plugins: [
		tailwindcss(),
		previewKeepAlive(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Pinned so `bun run build` proves a deployable artifact rather than
			// succeeding while adapting to nothing. A consuming app may swap this
			// for its own target: https://svelte.dev/docs/kit/adapters
			//
			// The Capacitor target is the one exception: a WebView has no Node to
			// run a server bundle, so that build emits a static SPA into its own
			// directory. Both are real artifacts; neither adapts to nothing.
			adapter: process.env.VITE_CAPACITOR
				? adapterStatic({
						pages: 'build-capacitor',
						assets: 'build-capacitor',
						fallback: 'index.html',
						precompress: false
					})
				: adapter()
		})
	],
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
