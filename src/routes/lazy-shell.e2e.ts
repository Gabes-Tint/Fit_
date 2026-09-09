import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, signInThroughApi } from '../../tests/e2e-support';
import { builtChunkPathContaining } from '../../tests/built-chunk';

/**
 * The shell fetches its drawer after it has drawn, not before.
 *
 * `AppShell` imports `SideNav` dynamically, which takes the drawer — and the
 * `bits-ui` dialog, focus scope and `tabbable` that only it uses — out of the
 * JavaScript every page has to load before it can show anything. That is worth
 * bytes on the `bundle:headroom` closure number, but bytes are not the claim
 * being made to the person holding the phone. The claim is that the deferral
 * costs them nothing: the page still arrives, and the menu button still opens a
 * drawer even when the network has not caught up yet.
 *
 * So this holds that one chunk back and asserts both halves. A static import
 * would fail the first test by never painting at all, and a naive fix — mounting
 * the drawer only once the chunk lands — would fail the second by dropping the
 * tap that arrived first.
 */

/**
 * Text that exists only in the drawer, so its chunk can be recognized without
 * naming a filename: every emitted chunk is content-hashed and renamed by any
 * change to it.
 */
const DRAWER_MARKER = 'Everything stays on this device.';

/**
 * Stall the drawer's chunk until the returned function is called. Nothing else
 * is intercepted, so only this one thing is late.
 *
 * The chunk is found by its marker in the build on disk rather than by
 * intercepting every script and reading each body, which is what this used to
 * do. That cost more than the round trips. `page.unrouteAll` empties its own
 * list of handlers first and only then waits for the handlers already running —
 * and each of those, as it finishes, sees the empty list and tells the browser
 * to stop intercepting, without waiting for its siblings. The first such
 * message lands while the others are still parked inside `route.fetch()`, and
 * Playwright answers it by continuing every request still held in a handler
 * itself. The next one to reach `route.fulfill` was then fulfilling a request
 * Playwright had already answered: `Route is already handled!`, and a red shard
 * for a drawer that worked (#303).
 *
 * With one URL intercepted there is one request in the handler and no sibling
 * to be continued out from under it. Releasing lets that request through and
 * waits for it before taking the interception down, so the teardown can only
 * ever run with nothing in flight.
 */
async function holdBackTheDrawer(page: Page): Promise<() => Promise<void>> {
	let release = (): void => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const letThrough: Promise<void>[] = [];
	await page.route(`**${builtChunkPathContaining(DRAWER_MARKER)}`, async (route) => {
		const passed = held.then(() => route.continue());
		letThrough.push(passed);
		await passed;
	});
	return async () => {
		release();
		await Promise.all(letThrough);
		await page.unrouteAll({ behavior: 'wait' });
		// A hold that intercepted nothing would leave both tests asserting the
		// ordinary case, in silence: the drawer that arrived on time.
		expect(letThrough.length, 'the drawer chunk was never requested').toBeGreaterThan(0);
	};
}

test('draws the journal while the drawer is still on its way', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	const release = await holdBackTheDrawer(page);
	try {
		// Reaches its own assertion — the Today heading — with the drawer's chunk
		// still in flight, which is the whole point of it not being in the shell.
		await openEmptyJournal(page);
		await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
		await expect(page.getByRole('dialog')).toBeHidden();
	} finally {
		await release();
	}
});

test('opens the drawer for a tap that beat its chunk to the screen', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	const release = await holdBackTheDrawer(page);
	try {
		await openEmptyJournal(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
	} finally {
		await release();
	}

	// The tap is not lost waiting: the drawer opens the moment it can, on the
	// choice already made rather than on a second tap.
	for (const label of ['Today', 'Progress', 'Exercise', 'Plan', 'You']) {
		await expect(page.getByRole('link', { name: label })).toBeVisible();
	}
});
