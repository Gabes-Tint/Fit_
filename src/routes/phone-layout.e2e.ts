import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	OLIVE_OIL_ROW,
	atNarrowPhone,
	expectFitsViewport,
	openEmptyJournal,
	openLogSheet,
	openLogSheetAndType,
	openSampleJournal,
	signInThroughApi,
	stubFoodResolve
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
		await atNarrowPhone(page);
		await openEmptyJournal(page);

		await openLogSheet(page);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		const results = page.getByRole('list').filter({ has: page.getByRole('listitem') });
		await expect(results.first()).toBeVisible();
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
});
