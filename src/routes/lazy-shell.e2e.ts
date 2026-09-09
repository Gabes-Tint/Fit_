import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, signInThroughApi } from '../../tests/e2e-support';

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
 * Stall the drawer's chunk until the returned function is called. Every other
 * request is passed straight through, so only this one thing is late.
 *
 * Recognizing the chunk costs an interception of every script the app asks
 * for, and the app keeps asking after the last assertion has been made: the
 * log sheet, the onboarding screen and the route chunks behind the drawer's
 * own links all arrive on their own schedule. One of those was still inside
 * `route.fetch()` when this test ended in run 34293608030, which fails the
 * whole shard under `failOnFlakyTests` -- not because anything about the
 * drawer was wrong, but because an interception outlived what it was for.
 *
 * So releasing also takes the interception down: `unrouteAll` waits for the
 * handler this just let go of to finish fulfilling, and every script asked for
 * afterwards is served without passing through here at all.
 */
async function holdBackTheDrawer(page: Page): Promise<() => Promise<void>> {
	let release = (): void => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/_app/immutable/**/*.js', async (route) => {
		const response = await route.fetch();
		const body = await response.text();
		if (body.includes(DRAWER_MARKER)) await held;
		await route.fulfill({ response, body });
	});
	return async () => {
		release();
		await page.unrouteAll({ behavior: 'wait' });
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
