import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	CHIPS_NAME,
	CHIPS_ROW,
	EGG_ROW,
	OLIVE_OIL_ROW,
	atNarrowPhone,
	expectFitsViewport,
	openEmptyJournal,
	openLogCardFor,
	openLogSheet,
	openExerciseTabEmpty,
	openLogSheetAndType,
	openSampleJournal,
	pickFullBodyTemplate,
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

	test('the Today weight trend card stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await openSampleJournal(page);

		const weightCard = page.getByRole('group', { name: 'Weight trend' });
		await expectFitsViewport(page, weightCard);
	});

	test('the exercise training strip stays inside the viewport', async ({ page, baseURL }) => {
		await openExerciseTabEmpty(page, baseURL ?? '');
		await pickFullBodyTemplate(page);

		await atNarrowPhone(page);
		const strip = page.getByRole('link', { name: /^Today/ }).locator('xpath=..');
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

	test('a search result carrying an appended mass stays inside the viewport', async ({
		page,
		baseURL
	}) => {
		// #74 lengthened every row in this list: the serving label now carries the
		// mass beside it. Imperial is the longer of the two readings ("3.5 oz"
		// against "100 g"), and a long branded name in front of it is the widest
		// this row gets.
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodSearch(page, [
			{
				...EGG_ROW,
				id: 902,
				name: 'Chocolate Chip Cookie Dough Bar, Family Size',
				brand: 'KIND',
				serving: { label: '100 g', grams: 100 }
			}
		]);
		await openEmptyJournal(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'You' }).click();
		await page.getByRole('button', { name: 'Imperial' }).click();
		await page.goto('/');
		await atNarrowPhone(page);

		await openLogSheet(page);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByLabel('Search foods, brands, barcodes').fill('cookie dough');
		await expect(page.getByText('100 g · 3.5 oz')).toBeVisible();
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

	test('a toast stays inside the viewport', async ({ page, baseURL }) => {
		// The longest sentence the app raises as a toast, at the width toasts are
		// most likely to spill at. The offline branch of the matcher is how to get
		// it on screen: it is the one message that does not fit on a line.
		await signInThroughApi(page, baseURL ?? '');
		await page.route('**/api/foods/resolve', (route) => route.fulfill({ status: 503, body: '' }));
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		await openLogSheetAndType(page, '2 tablespoons olive oil');
		await page.getByRole('button', { name: 'Parse' }).click();

		const toast = page.getByText(
			'Matching needs the server. You can pick from Search when you\u2019re back online.'
		);
		await expect(toast).toBeVisible();
		await expectFitsViewport(page, toast);
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

		const row = page.getByRole('button', { name: 'Olive oil USDA 2 × 1 tbsp (15 ml) · 28 g 238' });
		await expect(row).toBeVisible();
		await expectFitsViewport(page, row);
	});

	test('an exercise session stays inside the viewport', async ({ page, baseURL }) => {
		await openExerciseTabEmpty(page, baseURL ?? '');
		await pickFullBodyTemplate(page);

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

	test('the delete-routine confirm sheet stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await openSampleJournal(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Exercise' }).click();
		await page.getByRole('button', { name: /Full body/ }).click();
		await expect(page.getByRole('heading', { name: 'Exercise', level: 1 })).toBeVisible();
		await page.getByRole('link', { name: /Full body \d+ exercises/ }).click();
		await expect(page.getByRole('button', { name: 'Start this session' })).toBeVisible();
		await page.getByRole('link', { name: 'Edit' }).click();
		await expect(page.getByRole('button', { name: 'Add from library' })).toBeVisible();

		await atNarrowPhone(page);
		await page.getByRole('button', { name: 'Delete routine' }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet).toBeVisible();
		await expectFitsViewport(page, sheet);
	});

	test('a load read in pounds stays inside the viewport, sheet to summary (#71)', async ({
		page,
		baseURL
	}) => {
		await openExerciseTabEmpty(page, baseURL ?? '');
		await pickFullBodyTemplate(page);

		// Loads are stored in kilograms and converted for reading (#71), so pounds
		// are the wide case everywhere a load is printed: the template's 60 kg squat
		// reads 132.3, and a session's volume gains a digit.
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'You' }).click();
		await page
			.getByRole('group', { name: 'Exercise load unit: kg or lb' })
			.getByRole('button', { name: 'lb' })
			.click();

		await atNarrowPhone(page);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Exercise' }).click();
		await page.getByRole('link', { name: /Full body \d+ exercises/ }).click();

		// The routine sheet, where the reading sits in a fixed grid column.
		await expect(page.getByText('Load (lb)').first()).toBeVisible();
		await expect(page.getByText('132.3').first()).toBeVisible();
		await expectFitsViewport(page);

		// The session's set list, where the same reading sits between two steppers.
		await page.getByRole('button', { name: 'Start this session' }).click();
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();
		await expect(page.getByText('132.3').first()).toBeVisible();
		await expectFitsViewport(page);

		// The summary's volume tile: eight reps of the squat, which is 480 kg of
		// work read back as 1058 lb — the widest number any of these screens print.
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.getByRole('button', { name: 'Finish' }).click();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
		const volume = page.getByText('1058 lb', { exact: true });
		await expect(volume).toBeVisible();
		await expectFitsViewport(page, volume);
	});

	test('the log sheet quantity control stays inside the viewport (#158)', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodSearch(page, [CHIPS_ROW]);
		await openEmptyJournal(page);
		await atNarrowPhone(page);

		await openLogCardFor(page, CHIPS_NAME, 'tortilla chips');

		// The label serving the source gave, in servings — not 100 g, and not a
		// bare weight (#157).
		const dialog = page.getByRole('dialog');
		await expect(page.getByLabel('Amount in servings')).toHaveValue('1');
		await expectFitsViewport(page, dialog);

		// The whole pack, which is the widest reading the row can carry.
		await page.getByRole('button', { name: 'Whole pack · 155 g' }).click();
		await expect(page.getByText(/^775 kcal/)).toBeVisible();
		await expectFitsViewport(page, dialog);

		// And the same amount read as a weight, where the toggle names servings
		// and the field carries three digits.
		await page.getByLabel('Enter the amount in grams').click();
		await expect(page.getByLabel('Amount in grams')).toHaveValue('155');
		await expectFitsViewport(page, dialog);
	});

	test('the usual-portion hint and its reset chip stay inside the viewport (#159)', async ({
		page,
		baseURL
	}) => {
		// #159 puts a whole sentence above the quantity control, and a chip row
		// under it that a packaged food gives two entries. Metric is the wide
		// reading of the sentence: the "1 oz" label already states an imperial
		// mass, so only a metric reader gets the "· 45 g" appended to it (#74).
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodSearch(page, [CHIPS_ROW]);
		await openEmptyJournal(page);

		await openLogCardFor(page, CHIPS_NAME, 'tortilla chips');
		await page.getByLabel('Enter the amount in grams').click();
		await page.getByLabel('Amount in grams').fill('45');
		await page.getByRole('button', { name: 'Add to today' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		await atNarrowPhone(page);
		await openLogCardFor(page, CHIPS_NAME, 'tortilla chips');

		const dialog = page.getByRole('dialog');
		await expect(page.getByText('Your usual · 1.61 × 1 oz · 45 g')).toBeVisible();
		await expectFitsViewport(page, dialog);

		// And with the reset taken, where the chip row is still two chips wide.
		await page.getByRole('button', { name: '1 oz', exact: true }).click();
		await expect(page.getByLabel('Amount in servings')).toHaveValue('1');
		await expectFitsViewport(page, dialog);
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
		// One serving leads with the label rather than "1 × " (#74), and the label
		// already states its mass in metric, so nothing is appended to it.
		await expect(page.getByText('1 sandwich (219 g)')).toBeVisible();
		await expect(page.getByLabel('Show unit count')).toBeVisible();
		await expectFitsViewport(page, row.locator('xpath=../..'));
	});
});
