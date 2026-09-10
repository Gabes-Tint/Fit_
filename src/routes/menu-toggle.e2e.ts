import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	openSampleJournal,
	refuseStateAsTooLarge,
	signInThroughApi
} from '../../tests/e2e-support';

/**
 * The menu is one button in one place, and it never leaves the screen.
 *
 * The top bar it used to live in is gone, so this floating toggle in the
 * bottom-right corner is the whole of the navigation chrome: a hamburger while
 * the drawer is shut, an X while it is open, and — this is the part that only a
 * real browser can prove — reachable above the drawer's own overlay, so the
 * thumb that opened the drawer closes it again without moving.
 */

async function openTheJournal(page: Parameters<typeof openSampleJournal>[0], baseURL: string) {
	await signInThroughApi(page, baseURL);
	await page.goto('/');
	await openSampleJournal(page);
}

test('opens and closes the drawer from the one button, in the one corner', async ({
	page,
	baseURL
}) => {
	await openTheJournal(page, baseURL ?? '');

	const toggle = page.getByRole('button', { name: 'Open menu' });
	await expect(toggle).toBeVisible();
	await toggle.click();

	// Same button, renamed, still on screen with the drawer over everything else.
	const closer = page.locator('[data-menu-fab]');
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(closer).toBeVisible();
	await expect(closer).toHaveAttribute('aria-expanded', 'true');

	/*
	 * The regression this whole arrangement is built around: the toggle floats
	 * above the drawer's overlay, so the drawer reads a tap on it as an outside
	 * interaction and — left alone — closes on `pointerdown`, whereupon the
	 * toggle's own click opens it straight back up. One tap has to leave it shut
	 * and keep it shut.
	 */
	await closer.click();
	// Focus coming back to the toggle is the last thing the drawer does on its
	// way out, so waiting for it puts this assertion after everything the tap
	// set in motion — and a drawer that reopened would have taken focus with it.
	await expect(toggle).toBeFocused();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('hands focus back to the toggle when the drawer closes', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	const toggle = page.getByRole('button', { name: 'Open menu' });
	await toggle.click();
	/*
	 * The drawer has to be on screen before there is anything to close.
	 * `SideNav` arrives in its own chunk, so between the two taps below there is
	 * a window in which it has not mounted yet — and a second tap taken in that
	 * window sets `menuOpen` back to false before the drawer ever appears.
	 * Everything after it then holds for the wrong reason: no dialog was ever
	 * created, and the toggle is focused because it was the thing just clicked.
	 * Withholding the chunk outright is enough to make the point — without this
	 * line the test passes with no drawer in the run at all.
	 */
	await expect(page.getByRole('dialog', { name: 'Fit_' })).toBeVisible();
	await page.locator('[data-menu-fab]').click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(toggle).toBeFocused();
});

test('still closes on a tap outside the drawer', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	await page.getByRole('button', { name: 'Open menu' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();

	// The overlay, well clear of both the panel on the left and the toggle in
	// the bottom-right corner: the drawer declines to close only for the toggle,
	// and everywhere else must behave exactly as it did before.
	const viewport = page.viewportSize();
	await page.mouse.click((viewport?.width ?? 400) - 20, 20);
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('still closes on Escape', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	await page.getByRole('button', { name: 'Open menu' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('gives the top of the screen back, and keeps the wordmark in the drawer', async ({
	page,
	baseURL
}) => {
	await openTheJournal(page, baseURL ?? '');

	// One banner, and it is the page's own header rather than a bar of chrome
	// above it: the top bar used to be a second one.
	const header = page.getByRole('banner');
	await expect(header).toHaveCount(1);
	const box = await header.boundingBox();
	expect(box, 'the page header has no box to measure').not.toBeNull();
	// A 3.5rem bar and the safe area it padded for used to sit above this.
	const { y } = box as { y: number };
	expect(y, `the page header still starts ${y}px down, as though a bar were above it`).toBeLessThan(
		56
	);

	// The wordmark the bar carried is off screen until the drawer is asked for,
	// which is where it went.
	await expect(page.getByText('Fit_', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Open menu' }).click();
	await expect(page.getByRole('dialog', { name: 'Fit_' })).toBeVisible();
});

/**
 * The toggle is above the drawer and below everything else.
 *
 * Getting that wrong in the other direction is the worse failure of the two: a
 * toggle painted over an open log sheet sits on top of a row somebody is trying
 * to press, and a tap on it opens the navigation drawer *behind* the sheet —
 * out of sight, out of reach, with the button reporting it as expanded.
 */
test('disappears under an open sheet, and comes back when it closes', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	const toggle = page.locator('[data-menu-fab]');
	const box = await toggle.boundingBox();
	expect(box, 'the menu toggle has no box to measure').not.toBeNull();
	const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
	const centre = { x: x + width / 2, y: y + height / 2 };

	await page
		.getByRole('region', { name: 'Energy' })
		.getByRole('button', { name: 'Log food' })
		.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();

	// Whatever is painted at the toggle's own centre is the sheet, not the
	// toggle: the sheet covers it completely rather than leaving it floating
	// over the sheet's own rows.
	const onTop = await page.evaluate((point) => {
		const target = document.elementFromPoint(point.x, point.y);
		return target?.closest('[data-menu-fab]') !== null ? 'toggle' : 'something else';
	}, centre);
	expect(onTop, 'the menu toggle is painted on top of an open sheet').toBe('something else');

	// And it is not merely covered: nothing that reaches it while a sheet is up
	// gets to open a drawer behind that sheet.
	await toggle.evaluate((el) => (el as HTMLElement).click());
	await expect(page.getByRole('dialog', { name: 'Fit_' })).toHaveCount(0);
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');

	// Closed again, the toggle is back and works.
	await page.getByRole('button', { name: 'Close' }).click();
	/*
	 * Gone from the document, not merely out of sight. The tap on the next line
	 * is judged by `MenuFab`'s own guard, which asks whether any
	 * `[data-dialog-content]` other than the drawer *exists* — it never consults
	 * visibility. A sheet still in the DOM would therefore swallow the tap while
	 * `toBeHidden` was already satisfied, so this waits on the predicate the
	 * component actually reads rather than a weaker one that resembles it.
	 */
	await expect(sheet).toHaveCount(0);
	await toggle.click();
	await expect(page.getByRole('dialog', { name: 'Fit_' })).toBeVisible();
});

/**
 * A thumb has the floating toggle; a keyboard has the drawer's own close, which
 * is inside the modal's tab ring where the toggle outside it can never be.
 */
test('closes from the keyboard, and hands focus back to the toggle', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	await page.getByRole('button', { name: 'Open menu' }).click();
	const drawer = page.getByRole('dialog', { name: 'Fit_' });
	await expect(drawer).toBeVisible();

	const close = drawer.getByRole('button', { name: 'Close menu' });
	await expect(close).toHaveCount(1);

	// First in the drawer's tab ring, so it is what the keyboard lands on the
	// moment the drawer opens rather than something to hunt for — and the ring
	// then walks on into the destinations.
	await expect(close).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(drawer.getByRole('link', { name: 'Today' })).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(close).toBeFocused();

	await page.keyboard.press('Enter');

	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
});

/**
 * The toggle floats above the drawer with a higher z-index (z-45 vs z-40), so
 * it stays tappable even when the drawer is open behind it. This test verifies
 * that elementFromPoint at the toggle's centre returns the toggle itself when
 * the drawer is open, for both right-handed and left-handed settings.
 */
test('stays on top of the open drawer, tappable to close', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	const toggle = page.locator('[data-menu-fab]');
	const box = await toggle.boundingBox();
	expect(box, 'the menu toggle has no box to measure').not.toBeNull();
	const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
	const centre = { x: x + width / 2, y: y + height / 2 };

	// Open the drawer
	await toggle.click();
	await expect(page.getByRole('dialog', { name: 'Fit_' })).toBeVisible();

	// The toggle's centre should still be occupied by the toggle itself, not the
	// drawer behind it. The toggle is painted above the drawer (z-45 over z-40)
	// so the thumb that opened it can close it again without moving.
	const onTop = await page.evaluate((point) => {
		const target = document.elementFromPoint(point.x, point.y);
		return target?.closest('[data-menu-fab]') !== null ? 'toggle' : 'something else';
	}, centre);
	expect(onTop, 'the menu toggle is painted on top of the open drawer').toBe('toggle');

	// Close it again to verify the tap still works
	await toggle.click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('stays on top of the open drawer when left-handed', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	// Enable left-handed mode
	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('link', { name: 'You' }).click();
	await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
	await page.getByRole('switch', { name: 'Left-handed' }).click();
	await page.goto('/');

	const toggle = page.locator('[data-menu-fab]');
	const box = await toggle.boundingBox();
	expect(box, 'the menu toggle has no box to measure').not.toBeNull();
	const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
	const centre = { x: x + width / 2, y: y + height / 2 };

	// Open the drawer
	await toggle.click();
	await expect(page.getByRole('dialog', { name: 'Fit_' })).toBeVisible();

	// Same check: toggle should be on top even when left-handed
	const onTop = await page.evaluate((point) => {
		const target = document.elementFromPoint(point.x, point.y);
		return target?.closest('[data-menu-fab]') !== null ? 'toggle' : 'something else';
	}, centre);
	expect(onTop, 'the menu toggle is painted on top of the open drawer in left-handed mode').toBe(
		'toggle'
	);
});

/**
 * The sync notice used to have a top bar between it and the page. It has not
 * had one since the menu moved, so the page reserves its height instead — and
 * this is the failure that reservation exists to prevent: the notice printing
 * over the heading of the page somebody is reading.
 */
test('keeps the sync notice clear of the page header', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	// A refused write is the shortest route to a notice that stays up.
	await refuseStateAsTooLarge(page);
	await page.goto('/');
	await openSampleJournal(page);

	const notice = page.getByRole('status');
	await expect(notice).toContainText('Your data has outgrown what the server accepts');

	const noticeBox = await notice.boundingBox();
	const headerBox = await page.getByRole('banner').boundingBox();
	expect(noticeBox, 'the sync notice has no box to measure').not.toBeNull();
	expect(headerBox, 'the page header has no box to measure').not.toBeNull();
	const { y: noticeY, height: noticeHeight } = noticeBox as { y: number; height: number };
	const { y: headerY } = headerBox as { y: number };
	expect(
		noticeY + noticeHeight,
		`the sync notice runs to ${noticeY + noticeHeight}px, over a header that starts at ${headerY}px`
	).toBeLessThanOrEqual(headerY);
});
