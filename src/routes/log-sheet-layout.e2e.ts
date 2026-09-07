import { env } from 'node:process';
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, openLogSheet, signInThroughApi } from '../../tests/e2e-support';

/**
 * The Log sheet takes 95% of the phone screen (#162), not the whole thing:
 * `Sheet`'s `tall` prop makes the panel `h-[95dvh]` and bottom-anchored with
 * rounded top corners below the `sm` breakpoint, so the page still shows
 * above it. `LogSheet` pins its "Add to today" button in a footer outside
 * the scrollable results/proposals region so a long list cannot scroll it
 * away.
 *
 * `sm:` and up is unaffected — the panel reverts to the normal centered
 * bottom sheet there — so the 95%-height assertion below is registered only
 * for a phone-width project (mirrors `CHROMIUM_ONLY_SPECS` in
 * `playwright.config.ts`, which gates a whole spec the same way rather than
 * skipping inside a test). `E2E_PROJECT` is how both CI and a manual
 * `E2E_PROJECT=chromium bunx playwright test --project=chromium` run name
 * the project this file is executing under; `chromium` (Desktop Chrome,
 * 1280x720) is the only one of this file's two target projects past the
 * `sm` breakpoint. Everything else here — search, scroll containment,
 * Escape — is asserted on every project this file runs on.
 */

const isPhoneWidthProject = env.E2E_PROJECT !== 'chromium';

/** 30 rows named `Chicken breast, style 0..29` — enough to make the list scroll. */
function chickenRows(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		id: 9000 + i,
		name: `Chicken breast, style ${i}`,
		brand: null,
		kind: 'generic',
		category: 'Poultry',
		barcode: null,
		license: 'PDDL-1.0',
		serving: { label: '100 g', grams: 100 },
		per100g: { kcal: 165, protein: 31, fat: 3.6, carbs: 0, sugar: 0, fiber: 0, sodium: 74 }
	}));
}

/** Narrows Playwright's nullable `boundingBox()` result outside any test body. */
function requireBoundingBox(
	box: Awaited<ReturnType<Locator['boundingBox']>>
): NonNullable<typeof box> {
	if (!box) throw new Error('panel has no bounding box');
	return box;
}

async function stubChickenSearch(page: Page) {
	await page.route('**/api/foods?*', (route) => {
		const url = new URL(route.request().url());
		const q = url.searchParams.get('q') ?? '';
		const foods = q.toLowerCase().includes('chicken') ? chickenRows(30) : [];
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ foods })
		});
	});
}

test.describe('the Log sheet fills the screen on a phone', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
		await stubChickenSearch(page);
	});

	if (isPhoneWidthProject) {
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
	}

	test('the results scroll inside the panel, not the page, and the action button stays reachable', async ({
		page
	}) => {
		await openLogSheet(page);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByLabel('Search foods, brands, barcodes').fill('chicken');
		await expect(page.getByText('Chicken breast, style 29')).toBeVisible();

		// The results scroll inside the sheet's own region, not the page: that
		// region is what LogSheet gives `min-h-0 flex-1 overflow-y-auto`, and it
		// is the element proven to scroll below — not `document.documentElement`,
		// whose `scrollHeight` stays tall regardless (the Today screen behind the
		// dialog keeps its own height) and would pass even if nothing inside the
		// sheet scrolled at all.
		const scrollRegion = page.getByTestId('log-scroll');
		const [scrollHeight, clientHeight] = await scrollRegion.evaluate((el) => [
			el.scrollHeight,
			el.clientHeight
		]);
		expect(scrollHeight).toBeGreaterThan(clientHeight);

		// Picking a food makes the "Proposed" list — and its footer — appear; the
		// footer stays in the viewport even after scrolling the results.
		await page.getByText('Chicken breast, style 0', { exact: true }).click();
		const button = page.getByRole('button', { name: 'Add to today' });
		await expect(button).toBeInViewport();
		await scrollRegion.evaluate((el) => el.scrollTo(0, el.scrollHeight));
		await expect(button).toBeInViewport();
	});

	test('Escape closes the sheet back to Today', async ({ page }) => {
		await openLogSheet(page);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
	});
});
