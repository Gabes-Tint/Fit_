import { defineConfig, devices } from '@playwright/test';
import { availableParallelism } from 'node:os';
import { env } from 'node:process';
import { DEFAULT_E2E_PROJECT, e2eProjects, isE2eProjectName } from './scripts/quality/e2e-projects';

const isCI = Boolean(env.CI);
const baseURL = env.E2E_BASE_URL;
const proxy = env.ZAP_PROXY_URL ? { proxy: { server: env.ZAP_PROXY_URL } } : {};

/**
 * One project per hosted job (`E2E_PROJECT`), the full matrix locally with
 * `E2E_ALL_BROWSERS`, and the phone the app is built for by default.
 */
const requested = env.E2E_PROJECT;
if (requested !== undefined && !isE2eProjectName(requested)) {
	throw new Error(
		`Unknown E2E_PROJECT: ${requested}. Known projects: ${Object.keys(e2eProjects).join(', ')}.`
	);
}
const selected =
	requested === undefined
		? env.E2E_ALL_BROWSERS
			? Object.keys(e2eProjects)
			: [DEFAULT_E2E_PROJECT]
		: [requested];
/** Playwright has no fake-camera flag outside Chromium, so this file stays out of those projects. */
const CHROMIUM_ONLY_SPECS = '**/photo-camera.e2e.ts';
/** Its assertions only hold at a phone viewport, so desktop-width projects skip it. */
const PHONE_ONLY_SPECS = '**/log-sheet-height.e2e.ts';

const projects = selected.map((name) => {
	const project = e2eProjects[name as keyof typeof e2eProjects];
	const testIgnore = [
		...(project.browser === 'chromium' ? [] : [CHROMIUM_ONLY_SPECS]),
		...(project.phone ? [] : [PHONE_ONLY_SPECS])
	];
	return {
		name,
		use: { ...devices[project.device] },
		...(testIgnore.length > 0 ? { testIgnore } : {})
	};
});

/**
 * Half the cores. A worker is a browser and a preview server rather than a
 * browser alone. `workers: 1` used to be the containment for one shared server
 * and one shared database; `tests/preview-server.ts` gives each worker its own,
 * so the limit is the machine.
 *
 * Half rather than all of them, deliberately. WebKit on Linux is this suite's
 * fragile engine -- main flaked a `mobile-safari` test at `workers: 1` in run
 * 33917056886, before any of this -- and `failOnFlakyTests` means a test that
 * only passes on the retry fails the build. Runs 33916933876 and 33918527511
 * finished 292 tests each at half the cores with nothing flaky and no retry;
 * three workers on a four-core runner timed one out on the drawer. The last
 * core buys back more than it costs.
 *
 * A ZAP run is the exception: it names one server through `E2E_BASE_URL` and
 * scans what passes through one proxy.
 *
 * Spread rather than an explicit `undefined`: under `exactOptionalPropertyTypes`
 * an explicit `undefined` is not the same as an absent key, and Playwright's
 * own type says so. Absent is what "let Playwright choose" means.
 */
const hostedWorkers = { workers: Math.max(2, Math.floor(availableParallelism() / 2)) };
const workers = env.ZAP_PROXY_URL ? { workers: 1 } : isCI ? hostedWorkers : {};

/**
 * Shards report a blob each, merged into one HTML and one JSON report by the
 * workflow, so `reports/quality/playwright.json` still describes the whole run.
 */
const reporter = env.E2E_BLOB_REPORT
	? // Named after the project: every shard would otherwise write `report.zip`
		// and the merge job would collect one file, not four.
		([['list'], ['blob', { fileName: `report-${selected.join('-')}.zip` }]] as const)
	: ([
			['list'],
			['json', { outputFile: 'reports/quality/playwright.json' }],
			['html', { open: 'never' }]
		] as const);

export default defineConfig({
	globalSetup: './tests/e2e-build.ts',
	testMatch: '**/*.e2e.{ts,js}',
	reporter: [...reporter],
	forbidOnly: true,
	failOnFlakyTests: true,
	retries: isCI ? 1 : 0,
	...workers,
	updateSnapshots: isCI ? 'none' : 'missing',
	projects,
	use: {
		...(baseURL === undefined ? {} : { baseURL }),
		...proxy,
		trace: 'on-first-retry'
	}
});
