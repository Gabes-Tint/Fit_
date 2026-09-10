import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	type ResolvedRow,
	openEmptyJournal,
	openLogSheet,
	signInThroughApi,
	stubFoodSearch
} from '../../tests/e2e-support';

/**
 * #337, as a person meets it: a search for "green apple" that logged Claeys
 * hard candy at 400 kcal, because the row never said whose product it was and
 * the candy outranked the fruit.
 *
 * The ranking itself is proven where it lives — `plain-food.spec.ts` against a
 * catalog fixture, and `data/eval/search-queries.json` against the real 365 MB
 * file. There is no catalog in CI, so what these two tests own is the other
 * half: that the order the server sends is the order a person sees, and that a
 * branded row says its brand on the way in and on the way out.
 */

/** Whichever raw apple the ranking puts first — generic, and carrying no brand. */
const APPLE: ResolvedRow = {
	id: 9401,
	name: 'Apples, granny smith, with skin, raw',
	brand: null,
	kind: 'generic',
	category: 'Fruits',
	barcode: null,
	license: 'PDDL-1.0',
	serving: { label: '1 medium', grams: 182 },
	per100g: { kcal: 59, protein: 0.3, fat: 0.2, carbs: 14, sugar: 10, fiber: 2.4, sodium: 1 }
};

/** The row of the defect: food_id 180011, 400 kcal per 100 g, sold as three pieces. */
const CANDY: ResolvedRow = {
	id: 9402,
	name: 'GREEN APPLE',
	brand: 'CLAEYS',
	kind: 'branded',
	category: 'Sweets',
	barcode: null,
	license: 'PDDL-1.0',
	serving: { label: '3 PIECES', grams: 15 },
	servingOptions: [
		{ label: '3 PIECES', grams: 15 },
		{ label: '100 g', grams: 100 }
	],
	per100g: { kcal: 400, protein: 0, fat: 0, carbs: 100, sugar: 76, fiber: 0, sodium: 33 }
};

/** The results list of the log sheet, with the query already answered. */
async function searchGreenApple(page: Page) {
	await openLogSheet(page);
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await page.getByLabel('Search foods, brands, barcodes').fill('green apple');
	const results = page
		.getByRole('list')
		.filter({ has: page.getByRole('listitem') })
		.first();
	await expect(results.getByRole('listitem').first()).toBeVisible();
	return results;
}

test.describe('a search for "green apple"', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodSearch(page, [APPLE, CANDY]);
		await openEmptyJournal(page);
	});

	test('answers with the fruit first, and says whose candy the other row is', async ({ page }) => {
		const results = await searchGreenApple(page);

		const first = results.getByRole('listitem').first();
		await expect(first).toContainText('Apples, granny smith, with skin, raw');
		// Not branded: the row a person taps without reading is the food, and
		// the brand line is exactly what a branded row would add here.
		await expect(first).not.toContainText('CLAEYS');

		const candy = results.getByRole('listitem').filter({ hasText: 'GREEN APPLE' });
		await expect(candy).toContainText('CLAEYS');
		// The label the package states, beside the weight it comes to (#337).
		await expect(candy).toContainText('3 PIECES · 15 g');
	});

	test('carries the brand onto the journal row the candy is logged as', async ({ page }) => {
		const results = await searchGreenApple(page);
		await results.getByRole('button', { name: 'Log GREEN APPLE', exact: true }).click();
		// The `+` logs without closing the sheet, so more can be added; Escape is
		// how a person gets back to the journal it was written into.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();

		const logged = page.getByRole('listitem').filter({ hasText: 'GREEN APPLE' }).first();
		await expect(logged).toBeVisible();
		await expect(logged).toContainText('CLAEYS');
	});
});
