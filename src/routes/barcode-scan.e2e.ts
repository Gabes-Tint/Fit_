import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, openLogSheet, signInThroughApi } from '../../tests/e2e-support';

/**
 * PR #90 replaced the Scan tab's hard-coded demo button with a real reader.
 * Playwright's Chromium build does not implement `BarcodeDetector`
 * (`createBarcodeReader()` returns `null`), so every test here drives the
 * manual-digit fallback the component always keeps available — the camera
 * path itself is not exercised. See the final report for exactly what that
 * leaves unproven.
 */

const SINGLE_BARCODE = '602652171032';

/**
 * Every barcode goes to `/api/foods/barcode` — #146 removed the two bundled
 * packages that used to resolve with no network call at all. The real food
 * catalog (a 365 MB file built by a
 * separate ETL step) is not present in this environment, and the endpoint
 * answers 503 "catalog-unavailable" without it — so the "not found" and
 * "more than one match" server responses below are stubbed with
 * `page.route`, the same interception `sync.e2e.ts` already uses for the
 * server-unreachable case. What is real: the client's handling of a 404 and
 * of a multi-row 200 from its own endpoint contract. What is not proven:
 * that the live catalog actually returns these shapes for these codes.
 */
const UNKNOWN_BARCODE = '00000000000000';
const AMBIGUOUS_BARCODE = '00016000275287';

function catalogFood(id: number, name: string) {
	return {
		id,
		name,
		brand: 'Test Kitchen',
		kind: 'branded',
		category: 'Snacks',
		barcode: AMBIGUOUS_BARCODE,
		license: 'PDDL-1.0',
		serving: { label: '1 bar', grams: 40 },
		per100g: {
			kcal: 400,
			protein: 10,
			fat: 15,
			carbs: 40,
			sugar: 20,
			fiber: 3,
			sodium: 200,
			saturatedFat: 5
		}
	};
}

async function openScanTab(page: Page) {
	await openLogSheet(page);
	await page.getByRole('button', { name: 'Scan' }).click();
}

/** Scans a barcode two foods share and waits for the disambiguation prompt. */
async function presentAmbiguousChoice(page: Page) {
	const first = catalogFood(1, 'Chocolate Chip Cookie Dough Bar');
	const second = catalogFood(2, 'Chocolate Chip Cookie Dough Bar, Family Size');
	await page.route('**/api/foods/barcode*', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ barcode: AMBIGUOUS_BARCODE, ambiguous: true, foods: [first, second] })
		})
	);
	await openScanTab(page);
	await page.getByLabel('Barcode digits').fill(AMBIGUOUS_BARCODE);
	await page.getByRole('button', { name: 'Look it up' }).click();
	await expect(page.getByText('That barcode names more than one food. Which is it?')).toBeVisible();
	return { first, second };
}

test.describe('scanning a barcode', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
	});

	test('falls back to manual digit entry, since this engine has no BarcodeDetector', async ({
		page
	}) => {
		await openScanTab(page);
		await expect(
			page.getByText('This device can’t read a barcode with its camera. Type the digits instead.')
		).toBeVisible();
		await expect(page.getByLabel('Barcode digits')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Look it up' })).toBeDisabled();
	});

	test('logs the single food a known barcode names', async ({ page }) => {
		const only = catalogFood(3, 'Dark Chocolate Nuts & Sea Salt');
		await page.route('**/api/foods/barcode*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ barcode: SINGLE_BARCODE, ambiguous: false, foods: [only] })
			})
		);
		await openScanTab(page);
		await page.getByLabel('Barcode digits').fill(SINGLE_BARCODE);
		await page.getByRole('button', { name: 'Look it up' }).click();

		// Resolves straight to a proposal — no "which one" question for a single match.
		await expect(page.getByText('Proposed — tap to correct')).toBeVisible();
		await expect(page.getByText(only.name)).toBeVisible();

		await page.getByRole('button', { name: 'Add to today' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(page.getByText(only.name)).toBeVisible();
	});

	test('gives a way forward for a barcode nothing recognizes', async ({ page }) => {
		await page.route('**/api/foods/barcode*', (route) =>
			route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) })
		);
		await openScanTab(page);
		await page.getByLabel('Barcode digits').fill(UNKNOWN_BARCODE);
		await page.getByRole('button', { name: 'Look it up' }).click();

		await expect(
			page.getByText(
				`Nothing in the catalog carries ${UNKNOWN_BARCODE}. Search for it by name and log it that way.`
			)
		).toBeVisible();
		// Not a dead end: retry, or hand off to search, both stay reachable.
		await expect(page.getByRole('button', { name: 'Scan again' })).toBeVisible();
		await page.getByRole('button', { name: 'Search by name' }).click();
		await expect(page.getByRole('button', { name: 'Search' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('lists both foods a duplicated barcode names, and logs neither on its own', async ({
		page
	}) => {
		const { first, second } = await presentAmbiguousChoice(page);
		await expect(page.getByText(first.name, { exact: true })).toBeVisible();
		await expect(page.getByText(second.name, { exact: true })).toBeVisible();
		// Neither is auto-picked: no proposal exists yet, and the sheet is still open on the choice.
		await expect(page.getByText('Proposed — tap to correct')).toHaveCount(0);
		await expect(page.getByRole('dialog')).toBeVisible();
	});

	test('logs the one food picked from a duplicated barcode’s list, not the other', async ({
		page
	}) => {
		const { second } = await presentAmbiguousChoice(page);
		// The click is on the food's own name, not a role/name lookup: both listed
		// foods share "Chocolate Chip Cookie Dough Bar" as a prefix of their
		// accessible name (brand and kcal follow it), so only an exact text match
		// picks the second one and not the first.
		await page.getByText(second.name, { exact: true }).click();

		await expect(page.getByText('Proposed — tap to correct')).toBeVisible();
		await expect(page.getByText(second.name, { exact: true })).toBeVisible();

		await page.getByRole('button', { name: 'Add to today' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(page.getByText(second.name, { exact: true })).toBeVisible();
		// The other match from the same barcode was never proposed or logged.
		await expect(page.getByText('Chocolate Chip Cookie Dough Bar', { exact: true })).toHaveCount(0);
	});
});
