import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	EGG_ROW,
	openEmptyJournal,
	openLogSheet,
	signInThroughApi,
	stubFoodSearch
} from '../../tests/e2e-support';

/**
 * The units preference (PR #73) only ever changes how a stored weight is
 * *read*; the kilograms on the account never change. PR review caught a
 * real regression class here: rounding a converted value before storing it,
 * which round-trips 160 lb through kg and back as 160.1 lb. These tests
 * drive the preference through the real screens (`/you` for the toggle,
 * `/progress` for the reading) rather than calling the domain functions
 * directly, so a UI-level reintroduction of that bug is caught too.
 */

/**
 * The two screens by address, rather than by walking the drawer to each one.
 *
 * The drawer is not what this spec proves, and it is covered on its own by
 * `version.e2e.ts`, `lazy-shell.e2e.ts`, `phone-layout.e2e.ts` and
 * `signin.e2e.ts`. What it cost here was the budget. The
 * round-trip test below alternates between `/you` and `/progress` six times,
 * and a drawer trip is two clicks: one to open it, one for the link. On the
 * `mobile-safari` shard a click spends one to two and a half seconds inside
 * Playwright's actionability wait -- that is the engine's speed on a hosted
 * runner rather than anything this app does, and it is the same on every spec
 * -- so twelve of them put that one test at 29.6s of Playwright's 30s default
 * in run 34233599295, twice the next slowest test in the suite. The attempt
 * before it ran out of the 30s mid-action and was reported as a stuck "Open
 * menu" (#284); the click was not stuck, it was where the clock happened to
 * stop. A `goto` is one navigation and no actionability wait at all, and the
 * preference and the weight both survive one, which is what the reload test
 * asserts directly.
 */
async function openYou(page: Page) {
	await page.goto('/you');
	await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();
}

async function switchUnits(page: Page, label: 'Metric' | 'Imperial') {
	await openYou(page);
	await page.getByRole('button', { name: label }).click();
	await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
}

async function searchTheCatalog(page: Page, query: string) {
	await page.goto('/');
	await openLogSheet(page);
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await page.getByLabel('Search foods, brands, barcodes').fill(query);
}

/** Leaves the log sheet the way a person does, rather than navigating out from under it. */
async function closeLogSheet(page: Page) {
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
}

async function openProgress(page: Page) {
	await page.goto('/progress');
	await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
}

test.describe('the units preference, read on Progress and set on You', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
	});

	test('round-trips a pounds entry through metric and back without drift', async ({ page }) => {
		await switchUnits(page, 'Imperial');
		await openProgress(page);

		// 160 lb is the exact value review caught drifting to 160.1 lb after a
		// metric round trip, because a rounded-for-display value had leaked
		// into storage instead of the exact conversion.
		await page.getByLabel('Weight in pounds').fill('160');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		await expect(page.getByText(/160\.0/)).toBeVisible();

		await switchUnits(page, 'Metric');
		await openProgress(page);
		// 160 lb is exactly 72.574... kg; the display rounds it to one place.
		await expect(page.getByText(/72\.6/)).toBeVisible();

		await switchUnits(page, 'Imperial');
		await openProgress(page);
		// Back to pounds: still exactly 160.0, not 160.1 — nothing stored ever
		// changed, only the reading did.
		await expect(page.getByText(/160\.0/)).toBeVisible();
	});

	/**
	 * #74. The catalog's serving labels are free text from whatever source
	 * supplied them, so a preference cannot rewrite one — what it changes is
	 * the mass appended beside it. Driven through the real search box, because
	 * the rule has to reach the render sites and not only the domain function.
	 */
	test('reads a search result’s serving in the person’s own system', async ({ page }) => {
		await stubFoodSearch(page, [EGG_ROW]);

		await switchUnits(page, 'Imperial');
		await searchTheCatalog(page, 'egg');
		// The source wrote "1 large", which names no mass at all; 50 g a serving
		// is 1.8 oz, and the label stays so the portion is still a large egg.
		await expect(page.getByText('1 large · 1.8 oz')).toBeVisible();

		await closeLogSheet(page);
		await switchUnits(page, 'Metric');
		await searchTheCatalog(page, 'egg');
		await expect(page.getByText('1 large · 50 g')).toBeVisible();
	});

	test('persists the units preference across a reload', async ({ page }) => {
		await switchUnits(page, 'Imperial');
		// The reload lands back on `/you`, which is where the toggle is: what has
		// to survive it is the preference, not the way anyone got to the screen.
		await page.reload();
		await expect(page.getByRole('button', { name: 'Imperial' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await openProgress(page);
		await expect(page.getByLabel('Weight in pounds')).toBeVisible();
	});
});
