import { expect, type Locator } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, openLogSheet, signInThroughApi } from '../../tests/e2e-support';

/**
 * The Log sheet takes 95% of the phone screen (#162), not the whole thing:
 * `Sheet`'s `tall` prop makes the panel `h-[95dvh]` and bottom-anchored with
 * rounded top corners below the `sm` breakpoint, so the page still shows
 * above it. `sm:` and up reverts to the normal centered bottom sheet, so this
 * assertion only holds at a phone viewport.
 *
 * That's why this test lives in its own file rather than inside
 * `log-sheet-layout.e2e.ts`: `playwright.config.ts` gives this file a
 * `testIgnore` on every project whose `phone` flag (`scripts/quality/e2e-projects.ts`)
 * is false — the same `testIgnore` mechanism `photo-camera.e2e.ts` uses to stay
 * out of non-Chromium projects — rather than a conditional inside the test
 * (`eslint-plugin-playwright/no-conditional-in-test` forbids that) or an
 * `E2E_PROJECT !== 'chromium'` check, which reads as "not desktop" but only
 * actually excludes chromium: `firefox`, also desktop-width (1280x720), ran
 * this assertion anyway and failed CI (run 34091768917).
 */

/** Narrows Playwright's nullable `boundingBox()` result outside any test body. */
function requireBoundingBox(
	box: Awaited<ReturnType<Locator['boundingBox']>>
): NonNullable<typeof box> {
	if (!box) throw new Error('panel has no bounding box');
	return box;
}

test.describe('the Log sheet fills the screen on a phone', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
	});

	test('the panel takes ~95% of the viewport height below `sm`, anchored to the bottom, and never overflows horizontally', async ({
		page
	}) => {
		const viewport = page.viewportSize() ?? { width: 0, height: 0 };
		expect(viewport.width).toBeGreaterThan(0);
		await openLogSheet(page);
		const panel = page.getByRole('dialog');
		const box = requireBoundingBox(await panel.boundingBox());
		// ~95% of the viewport height, not edge to edge: the page still shows
		// above the sheet. Allow ±2% for the safe-area padding and rounding.
		expect(box.height).toBeGreaterThan(viewport.height * 0.93);
		expect(box.height).toBeLessThan(viewport.height * 0.97);
		expect(box.width).toBe(viewport.width);
		expect(box.x).toBe(0);
		// Bottom-anchored: the panel's bottom edge sits on the viewport's
		// bottom edge, and its top edge is below y=0 (the page is visible
		// above it), not fixed to the top like an edge-to-edge screen.
		expect(box.y).toBeGreaterThan(0);
		expect(box.y + box.height).toBeGreaterThan(viewport.height - 2);
		expect(box.y + box.height).toBeLessThan(viewport.height + 2);
		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
	});
});
