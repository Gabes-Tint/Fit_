import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openSampleJournal, signInThroughApi } from '../../tests/e2e-support';

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
	const closer = page.getByRole('button', { name: 'Close menu' });
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

	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('button', { name: 'Close menu' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
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
	await expect(page.getByRole('dialog')).toBeHidden();
});

test('still closes on Escape', async ({ page, baseURL }) => {
	await openTheJournal(page, baseURL ?? '');

	await page.getByRole('button', { name: 'Open menu' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
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
