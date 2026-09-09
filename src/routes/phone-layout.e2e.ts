import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	CHIPS_NAME,
	CHIPS_ROW,
	EGG_ROW,
	OLIVE_OIL_ROW,
	atNarrowPhone,
	expectFitsViewport,
	expectHittable,
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

		const weightCard = page.getByRole('region', { name: 'Weight' });
		await expectFitsViewport(page, weightCard);

		// The "Log weight" button used to sit over the chart's bottom-right
		// corner, and the chart reserved a right-hand gutter (`pr-16`) so its
		// newest point and end-date label were not hidden under it
		// (#today-card-actions review). The button now sits in its own row
		// below the chart, so the chart no longer needs to reserve that gutter
		// and should reach right up to the card's own padding.
		const chart = page.getByRole('img', { name: /Weight trend/ });
		await expect(chart).toBeVisible();
		const chartBox = await chart.boundingBox();
		const cardBox = await weightCard.boundingBox();
		expect(chartBox, 'chart has no box to measure').not.toBeNull();
		expect(cardBox, 'weight card has no box to measure').not.toBeNull();
		const { x: chartX, width: chartWidth } = chartBox as { x: number; width: number };
		const { x: cardX, width: cardWidth } = cardBox as { x: number; width: number };
		const chartRight = chartX + chartWidth;
		const cardRight = cardX + cardWidth;
		// The card's own horizontal padding (`px-4`, 16px) is the only gap that
		// should remain between the plot's right edge and the card's own right
		// edge — a few px of slack for subpixel layout, well short of the
		// ~64px a reserved `pr-16` gutter used to leave.
		expect(
			cardRight - chartRight,
			`chart's right edge is ${cardRight - chartRight}px short of the card's right edge — a gutter is still reserved`
		).toBeLessThanOrEqual(20);

		// The "Log weight" button now sits below the chart, right-aligned, and
		// still meets its 44px tap target with nothing else covering it.
		const logWeight = page.getByRole('button', { name: 'Log weight' });
		await expect(logWeight).toBeVisible();
		const buttonBox = await logWeight.boundingBox();
		expect(buttonBox, 'Log weight button has no box to measure').not.toBeNull();
		const { y: buttonY, height: buttonHeight } = buttonBox as { y: number; height: number };
		expect(
			buttonHeight,
			'Log weight button is shorter than its 44px tap target'
		).toBeGreaterThanOrEqual(44);
		// It sits below the chart's own bottom edge, not layered over it.
		const { y: chartY, height: chartHeight } = chartBox as { y: number; height: number };
		expect(
			buttonY,
			'Log weight button overlaps the chart instead of sitting below it'
		).toBeGreaterThanOrEqual(chartY + chartHeight - 1);
		await expectHittable(logWeight);
	});

	/**
	 * #today-polish: the chart's viewBox used to be a fixed 320x140 inside a
	 * box that could be much narrower, so `preserveAspectRatio`'s default
	 * `xMidYMid meet` shrank the drawing to the box's width and centred it,
	 * leaving a growing empty band above and below as the box got narrower —
	 * worst on the narrowest phone this ships to. The gridlines are a fixed
	 * distance from the plot's own top and bottom edges regardless of the
	 * data plotted, so they stand in for "where the plot actually starts and
	 * ends" without depending on where any particular weigh-in landed.
	 */
	test('the Today weight trend chart fills its box at 320px wide', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await page.setViewportSize({ width: 320, height: 800 });
		await openSampleJournal(page);

		const chart = page.getByRole('img', { name: /Weight trend/ });
		await expect(chart).toBeVisible();
		const chartBox = await chart.boundingBox();
		expect(chartBox, 'chart has no box to measure').not.toBeNull();
		const { y, height } = chartBox as { y: number; height: number };

		const gridlines = chart.locator('line');
		const topBox = await gridlines.first().boundingBox();
		const bottomBox = await gridlines.last().boundingBox();
		expect(topBox, 'gridlines missing, nothing to measure').not.toBeNull();
		expect(bottomBox, 'gridlines missing, nothing to measure').not.toBeNull();
		const { y: topY } = topBox as { y: number };
		const { y: bottomY, height: bottomHeight } = bottomBox as { y: number; height: number };

		// A band wider than the label row's own reserved space means the plot
		// has shrunk away from the box instead of filling it.
		const LABEL_ROW = 40;
		expect(topY - y, 'empty band above the plot is bigger than the label row').toBeLessThanOrEqual(
			LABEL_ROW
		);
		expect(
			y + height - (bottomY + bottomHeight),
			'empty band below the plot is bigger than the label row'
		).toBeLessThanOrEqual(LABEL_ROW);
	});

	test('the Today weight trend card stays inside the viewport expanded', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await openSampleJournal(page);

		await page.getByRole('button', { name: 'Log weight' }).click();
		const weightCard = page.getByRole('region', { name: 'Weight' });
		await expect(page.getByLabel('Weight in kilograms')).toBeVisible();
		await expectFitsViewport(page, weightCard);

		// Scrolled one step down, the way reading past the expanded form
		// naturally would: this used to be the exact scroll position where the
		// fixed "Log food" FAB sat over the "Today" submit button and stole its
		// tap (#today-card-actions review). The FAB is gone (#today-polish), but
		// the check stays as regression coverage against anything else that
		// ends up fixed at the bottom of the screen. A direct scroll rather than
		// a simulated wheel: Chromium's wheel-driven scroll can still be
		// mid-flight (and occasionally double-applies) the instant after
		// dispatch, which made this landing spot non-deterministic.
		await page.evaluate(() => window.scrollBy(0, 400));
		const submit = page.getByRole('button', { name: 'Today', exact: true });
		await expectHittable(submit);
	});

	test('the Today energy card stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await openSampleJournal(page);

		const energyCard = page.getByRole('region', { name: 'Energy' });
		await expectFitsViewport(page, energyCard);
	});

	// GLP-1 mode used to swap the Energy card for a concentric ring cluster
	// (#glp1-concentric-rings); it now shares the same one-ring-plus-bars
	// layout as calorie-led mode, only the bars differ (Protein/Fiber instead
	// of Protein/Carbs/Fat), so this replaces the old
	// `today-glp1-rings.e2e.ts` 360px coverage rather than dropping it.
	test('the Today energy card stays inside the viewport in GLP-1 mode', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('switch', { name: 'GLP-1 mode' }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

		const energyCard = page.getByRole('region', { name: 'Energy' });
		await expectFitsViewport(page, energyCard);
	});

	test('the Today training card stays inside the viewport', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await openSampleJournal(page);

		const trainingCard = page.getByRole('region', { name: 'Training' });
		await expectFitsViewport(page, trainingCard);
	});

	test('the Today weight trend card stays inside the viewport with a scrub selection showing', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await openSampleJournal(page);

		const weightCard = page.getByRole('region', { name: 'Weight' });
		const chart = weightCard.getByRole('img', { name: /Weight trend from/ });
		await chart.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			el.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					cancelable: true,
					pointerId: 7,
					pointerType: 'touch',
					clientX: rect.left + rect.width * 0.85,
					clientY: rect.top + rect.height / 2
				})
			);
		});
		await expect(page.getByText(/^[A-Z][a-z]{2} \d{1,2} · \d+\.\d (kg|lb)$/).first()).toBeVisible();

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

	test('a toast with Undo and Dismiss stays inside the viewport', async ({ page, baseURL }) => {
		// The one-tap-log toast is the widest of the two actions it can carry: at
		// 360px "Undo" and "Dismiss" sit at the right end of the same row as a
		// sentence naming the food and the meal, which is the shape most likely
		// to spill (#152's pattern, one screen the earlier sweep did not cover).
		// The longest branded name this file uses elsewhere (#152) is the food,
		// so the sentence is as wide as one of these toasts gets.
		const longName = 'Chocolate Chip Cookie Dough Bar, Family Size';
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodSearch(page, [{ ...EGG_ROW, id: 903, name: longName, brand: 'KIND' }]);
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		await openLogSheet(page);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await page.getByLabel('Search foods, brands, barcodes').fill('cookie dough');
		await page.getByRole('button', { name: `Log ${longName}`, exact: true }).click();

		const undo = page.getByRole('button', { name: 'Undo', exact: true });
		const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
		await expect(undo).toBeVisible();
		await expect(dismiss).toBeVisible();
		// Meal is whichever `guessMeal` picks for the time the test runs, so the
		// assertion only pins the food name and the sentence shape around it.
		await expect(page.getByText(new RegExp(`^Logged ${longName} to \\w+\\.$`))).toBeVisible();

		const toastBox = undo.locator('xpath=..');
		await expectFitsViewport(page, toastBox);
	});

	test('the sync notice for a document too large to send stays inside the viewport', async ({
		page,
		baseURL
	}) => {
		// The longest string the badge can show \u2014 152 characters, against the
		// offline notice's 88 \u2014 and the one that stays up rather than clearing
		// itself, so a phone that cannot fit it would be showing the overflow for
		// as long as the condition lasts (#282).
		await signInThroughApi(page, baseURL ?? '');
		await page.route('**/api/state', async (route) => {
			if (route.request().method() !== 'PUT') return route.continue();
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({ error: { code: 'invalid-body', reason: 'too-large' } })
			});
		});
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		// The badge is one live region whose text is swapped in and out, so the
		// region is the element to measure rather than a node matched on wording.
		const notice = page.getByRole('status');
		await expect(notice).toContainText(
			'Your data has outgrown what the server accepts, so it is not being sent. It is still saved on this device \u2014 export a backup from the You page.'
		);
		await expectFitsViewport(page, notice);
	});

	test('the notice for a device with no room left stays inside the viewport', async ({
		page,
		baseURL
	}) => {
		// The other standing notice (#300). It is shown by the store rather than by
		// sync, so it is reached by refusing the write instead of the request: a
		// browser out of room throws `QuotaExceededError` out of `setItem`, and
		// only for the document key, so signing in and onboarding still work.
		await signInThroughApi(page, baseURL ?? '');
		await page.addInitScript(() => {
			// Read off the descriptor rather than as `Storage.prototype.setItem`,
			// which is an unbound method and lints as one.
			const write = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')?.value as (
				this: Storage,
				key: string,
				value: string
			) => void;
			Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
				if (key === 'tend.v1') throw new DOMException('quota', 'QuotaExceededError');
				write.call(this, key, value);
			};
		});
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		const notice = page.getByRole('status');
		await expect(notice).toContainText(
			"This device's storage is full, so your latest changes are not saved on it. Export a backup from the You page."
		);
		await expectFitsViewport(page, notice);
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
