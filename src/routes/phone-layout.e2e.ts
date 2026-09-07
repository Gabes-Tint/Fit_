import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	EGG_ROW,
	OLIVE_OIL_ROW,
	atNarrowPhone,
	expectFitsViewport,
	openEmptyJournal,
	openLogSheet,
	openLogSheetAndType,
	openSampleJournal,
	signInThroughApi,
	stubFoodResolve,
	stubFoodSearch
} from '../../tests/e2e-support';

/**
 * #152: no project in `scripts/quality/e2e-projects.ts` renders a phone
 * narrower than 393px, so #133's day strip overflowed at 360px and passed
 * every shard. This file runs the six screens found unprotected — no e2e at
 * all for three of them, e2e but no layout assertion for the other three —
 * at 360x800 (`atNarrowPhone`) and checks nothing spills past the viewport
 * (`expectFitsViewport`).
 *
 * Phone projects only: `playwright.config.ts`'s `testIgnore` keeps this file
 * out of the desktop-width projects (`phone: false` in
 * `scripts/quality/e2e-projects.ts`), the same mechanism `photo-camera.e2e.ts`
 * uses to stay Chromium-only, rather than `test.skip` at runtime
 * (`eslint-plugin-playwright/no-skipped-test`).
 */

/** A genuine single-item measure (#178), the shape `/api/foods` sends it. */
const SANDWICH_ROW = {
	id: 9200,
	name: 'Breakfast Sandwich',
	brand: null,
	kind: 'branded',
	category: 'Fast Food',
	barcode: null,
	license: 'PDDL-1.0',
	serving: { label: '1 sandwich (219 g)', grams: 219 },
	per100g: { kcal: 250, protein: 12, fat: 14, carbs: 20, sugar: 4, fiber: 1.5, sodium: 460 }
};

/**
 * The Plan screen with the three-routine starter loaded. Its routine names are
 * the longest the app ships, so two of them sharing one day is the widest a
 * planned day can get — the shape #152 exists to catch.
 */
async function planScreenWithLongRoutines(page: Page, baseURL: string) {
	await signInThroughApi(page, baseURL);
	await page.goto('/');
	await openSampleJournal(page);
	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('link', { name: 'Exercise' }).click();
	await page.getByRole('button', { name: /Back & Arms/ }).click();
	await expect(page.getByRole('heading', { name: 'Exercise', level: 1 })).toBeVisible();
	await page.getByRole('link', { name: 'Plan', exact: true }).click();
	await expect(page.getByRole('button', { name: /^Mon / })).toBeVisible();
}

/** Puts the two longest-named routines on the week's Monday, in that order. */
async function fillMondayWithTwo(page: Page) {
	await page.getByRole('button', { name: /^Mon / }).click();
	await page.getByRole('button', { name: /Chest & Shoulders/ }).click();
	await page.getByRole('button', { name: /Back & Arms/ }).click();
}

test.describe('at 360px', () => {
	test('the Today week strip stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await openSampleJournal(page);

		const strip = page.getByRole('button', { name: /^Today/ }).locator('xpath=..');
		await expectFitsViewport(page, strip);
	});

	test('the log sheet Search results stay inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		// Since #146 every row in this list comes from the catalog endpoint, so
		// the stub is what puts anything on screen to measure. A long branded
		// name beside a two-word provenance badge is the row most likely to spill.
		await stubFoodSearch(page, [
			OLIVE_OIL_ROW,
			{ ...EGG_ROW, id: 901, name: 'Chocolate Chip Cookie Dough Bar, Family Size', brand: 'KIND' }
		]);
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		await openLogSheet(page);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByLabel('Search foods, brands, barcodes').fill('cookie dough');
		const results = page.getByRole('list').filter({ has: page.getByRole('listitem') });
		await expect(results.first()).toBeVisible();
		await expectFitsViewport(page, page.getByRole('dialog'));
	});

	test('the log sheet Search says it needs a connection without spilling', async ({
		page,
		baseURL
	}) => {
		// The other side of #146: with no catalog reachable there are no rows at
		// all, and the sheet's whole answer is one long sentence. On a 360px
		// phone that sentence is the thing that can overflow.
		await signInThroughApi(page, baseURL ?? '');
		await page.route('**/api/foods?*', (route) => route.fulfill({ status: 503, body: '' }));
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		await openLogSheet(page);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByLabel('Search foods, brands, barcodes').fill('cookie dough');
		await expect(
			page.getByText(
				'Search needs a connection, and the full catalog is out of reach right now. Try again in a moment.'
			)
		).toBeVisible();
		await expectFitsViewport(page, page.getByRole('dialog'));
	});

	test('the Scan tab stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		await openLogSheet(page);
		await page.getByRole('button', { name: 'Scan', exact: true }).click();
		await expect(page.getByLabel('Barcode digits')).toBeVisible();
		await expectFitsViewport(page, page.getByRole('dialog'));
	});

	test('a tbsp-labelled log row stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodResolve(page, [OLIVE_OIL_ROW]);
		await openEmptyJournal(page);
		await atNarrowPhone(page);

		await openLogSheetAndType(page, '2 tablespoons olive oil');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		const row = page.getByRole('button', { name: 'Olive oil USDA 2 × 1 tbsp (15 ml) 238' });
		await expect(row).toBeVisible();
		await expectFitsViewport(page, row);
	});

	test('an exercise session stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await openSampleJournal(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Exercise' }).click();
		await expect(page.getByRole('heading', { name: 'Nothing here yet', level: 1 })).toBeVisible();
		await page.getByRole('button', { name: /Full body/ }).click();
		await expect(page.getByRole('heading', { name: 'Exercise', level: 1 })).toBeVisible();

		await atNarrowPhone(page);
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();
		await expectFitsViewport(page);
	});

	test('the form-check modal stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await openSampleJournal(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Exercise' }).click();
		await page.getByRole('button', { name: /Full body/ }).click();
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();

		await atNarrowPhone(page);
		await page.getByRole('button', { name: 'Watch the movement' }).click();
		const modal = page.getByRole('dialog');
		await expect(modal).toBeVisible();
		await expectFitsViewport(page, modal);
	});

	test('a day carrying two routines stays inside the viewport', async ({ page, baseURL }) => {
		await planScreenWithLongRoutines(page, baseURL ?? '');
		await atNarrowPhone(page);

		await fillMondayWithTwo(page);
		await page.getByRole('button', { name: 'Close' }).click();

		// The row that carries both names, which is the one that can spill.
		const row = page.getByRole('button', { name: /^Mon .*, then / });
		await expect(row).toBeVisible();
		await expectFitsViewport(page, row);
	});

	test('the day planner stays inside the viewport with two routines on the day', async ({
		page,
		baseURL
	}) => {
		await planScreenWithLongRoutines(page, baseURL ?? '');
		await atNarrowPhone(page);

		await fillMondayWithTwo(page);

		const sheet = page.getByRole('dialog');
		await expect(sheet).toBeVisible();
		await expectFitsViewport(page, sheet);
	});

	test('a unit-toggled log row stays inside the viewport in both views (#178)', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodSearch(page, [SANDWICH_ROW]);
		await openEmptyJournal(page);
		await atNarrowPhone(page);

		await openLogSheet(page);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByLabel('Search foods, brands, barcodes').fill('breakfast sandwich');
		await page.getByText('Breakfast Sandwich', { exact: true }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		const row = page.getByRole('button', { name: /Breakfast Sandwich/ }).first();
		await expect(row).toBeVisible();
		// Defaults to the unit view (#178): "1 sandwich", not the weight label.
		await expect(page.getByText('1 sandwich', { exact: true })).toBeVisible();
		await row.click();

		const weightToggle = page.getByLabel('Show weight');
		await expect(weightToggle).toBeVisible();
		await expectFitsViewport(page, row.locator('xpath=../..'));

		await weightToggle.click();
		await expect(page.getByText('1 × 1 sandwich (219 g)')).toBeVisible();
		await expect(page.getByLabel('Show unit count')).toBeVisible();
		await expectFitsViewport(page, row.locator('xpath=../..'));
	});
});
