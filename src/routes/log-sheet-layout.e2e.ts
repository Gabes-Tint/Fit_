import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, openLogSheet, signInThroughApi } from '../../tests/e2e-support';

/**
 * The Log sheet takes 95% of the phone screen (#162), not the whole thing:
 * `Sheet`'s `tall` prop makes the panel `h-[95dvh]` and bottom-anchored with
 * rounded top corners below the `sm` breakpoint, so the page still shows
 * above it. `LogSheet` pins its "Add to today" button in a footer outside
 * the scrollable results/proposals region so a long list cannot scroll it
 * away. The 95%-height assertion itself lives in `log-sheet-height.e2e.ts`,
 * gated to phone-width projects only (see that file) — everything here
 * (search, scroll containment, Escape) holds at any viewport, so it runs on
 * every project this file executes under.
 */

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
