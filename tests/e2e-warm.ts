import { chromium, firefox, webkit } from 'playwright';
import { e2eProjects, isE2eProjectName } from '../scripts/quality/e2e-projects';

/**
 * Open one throwaway page per engine before the run's first test starts.
 *
 * A worker pays for its engine's cold start inside the timeout of whichever
 * test happens to run first: Playwright charges worker-fixture setup —
 * `Launch browser`, then `Create page` — to that test's 30 s budget. The cost
 * is a first touch on the machine, not per process, and on a hosted runner it
 * is unbounded. Measured on the `mobile-safari` job, first `Create page` per
 * worker against a median of ~0.3 s over 141 calls:
 *
 * | run      | worker 1 | worker 2 |
 * | -------- | -------- | -------- |
 * | 34279945936 |  1.54 s |  1.55 s |
 * | 34262399251 |  2.02 s |  2.04 s |
 * | 34263667412 |  3.01 s |  3.02 s |
 * | 34260554286 |  5.21 s |  5.22 s |
 * | 34259711568 | 12.54 s | 12.68 s |
 * | 34276753559 | 23.36 s | 23.37 s |
 *
 * That last one is #270. It left 6.6 s of the budget for a test that needs
 * about 3.9 s warm, the sign-in clicks ate 5.1 s of it, and the deadline
 * landed on the focus assertion in `openLogSheet` — which reported a focus
 * failure for a sheet that was open with its `Close` button focused. Any
 * assertion in that position would have failed the same way.
 *
 * That the cost is the machine's and not the process's is what makes warming
 * work: in the same run a third browser launched later took 112 ms against
 * the first two at 3.7 s, and all 140 pages created after the first two took
 * ~0.3 s. Paying it once here moves it off every test's clock — `globalSetup`
 * runs under `globalTimeout`, not a test timeout — without changing a single
 * timeout, retry setting, or assertion.
 */

/** Just the part of Playwright's browser API the warm-up touches. */
interface WarmPage {
	close(): Promise<void>;
}
interface WarmBrowser {
	newPage(): Promise<WarmPage>;
	close(): Promise<void>;
}
interface WarmLauncher {
	launch(): Promise<WarmBrowser>;
}

type E2eEngine = (typeof e2eProjects)[keyof typeof e2eProjects]['browser'];

const installedEngines: Record<E2eEngine, WarmLauncher> = { chromium, firefox, webkit };

/**
 * The distinct engines these projects need, in the order first asked for.
 * A name no project owns is skipped rather than thrown on: this runs for its
 * side effect, and refusing to build over a stray project name would fail the
 * whole run for something that costs a test nothing.
 */
function enginesFor(projectNames: readonly string[]): E2eEngine[] {
	const engines: E2eEngine[] = [];
	for (const name of projectNames) {
		if (!isE2eProjectName(name)) continue;
		const engine = e2eProjects[name].browser;
		if (!engines.includes(engine)) engines.push(engine);
	}
	return engines;
}

/**
 * One engine at a time, deliberately: launching all of them at once recreates
 * the contention this exists to keep off the test clock — the two workers in
 * run 34276753559 stalled together, not apart.
 *
 * The page is the point, not the launch. `Create page` is where the 23 s went;
 * a browser that never opens one leaves that cost for the first test to pay.
 */
export async function warmBrowsers(
	projectNames: readonly string[],
	engines: Record<E2eEngine, WarmLauncher> = installedEngines
): Promise<void> {
	for (const engine of enginesFor(projectNames)) {
		const browser = await engines[engine].launch();
		try {
			const page = await browser.newPage();
			await page.close();
		} finally {
			// Even when the page fails: a browser left running would outlive the
			// run and hold the machine the workers are about to compete for.
			await browser.close();
		}
	}
}
