import { describe, expect, it } from 'vitest';
import { warmBrowsers } from './e2e-warm';

/**
 * The regression #270 needed. The flake was not a focus race: the run's first
 * `Create page` per worker took 23.4 s against a 0.3 s median, inside the
 * first test's 30 s budget, and the assertion holding the baton at the
 * deadline was blamed for it. What has to stay true is that the run pays that
 * cold start once, before any test is being timed, for exactly the engines it
 * is about to use — and opens a page, since that is where the cost lives.
 */

interface Recorded {
	engine: string;
	pages: number;
	closed: boolean;
}

function fakeEngines(onPage?: () => never) {
	const log: Recorded[] = [];
	const make = (engine: string) => ({
		launch: () => {
			const record: Recorded = { engine, pages: 0, closed: false };
			log.push(record);
			return Promise.resolve({
				newPage: () => {
					if (onPage) onPage();
					record.pages += 1;
					return Promise.resolve({ close: () => Promise.resolve() });
				},
				close: () => {
					record.closed = true;
					return Promise.resolve();
				}
			});
		}
	});
	return {
		log,
		engines: { chromium: make('chromium'), firefox: make('firefox'), webkit: make('webkit') }
	};
}

describe('warming the engines a run is about to use', () => {
	it('opens and closes a page on the one engine a single-project run needs', async () => {
		const { log, engines } = fakeEngines();
		await warmBrowsers(['mobile-safari'], engines);
		expect(log).toEqual([{ engine: 'webkit', pages: 1, closed: true }]);
	});

	it('warms a shared engine once, not once per project', async () => {
		const { log, engines } = fakeEngines();
		await warmBrowsers(['mobile-chrome', 'chromium'], engines);
		expect(log.map((entry) => entry.engine)).toEqual(['chromium']);
	});

	it('warms every distinct engine when the whole matrix runs', async () => {
		const { log, engines } = fakeEngines();
		await warmBrowsers(['mobile-chrome', 'mobile-safari', 'chromium', 'firefox'], engines);
		expect(log.map((entry) => entry.engine)).toEqual(['chromium', 'webkit', 'firefox']);
	});

	it('launches nothing for a name no project owns, rather than failing the run', async () => {
		const { log, engines } = fakeEngines();
		await warmBrowsers(['not-a-project'], engines);
		expect(log).toEqual([]);
	});

	it('closes the browser when the page fails, so nothing outlives the warm-up', async () => {
		const { log, engines } = fakeEngines(() => {
			throw new Error('no page');
		});
		await expect(warmBrowsers(['mobile-safari'], engines)).rejects.toThrow('no page');
		expect(log).toEqual([{ engine: 'webkit', pages: 0, closed: true }]);
	});
});
