import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openSampleJournal, signInThroughApi } from '../../tests/e2e-support';
import AxeBuilder from '@axe-core/playwright';

/** Onboarding seeds meals but no training, so every run starts from an empty rotation. */
async function onboard(page: Page, baseURL: string) {
	// The tab is behind the gate like everything else, so the account comes first.
	await signInThroughApi(page, baseURL);
	await page.goto('/');
	await openSampleJournal(page);
	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('link', { name: 'Exercise' }).click();
	await expect(page.getByRole('heading', { name: 'Nothing here yet', level: 1 })).toBeVisible();
}

/** Scan every screen, not just two — the palette is reused at different tints, and contrast is what breaks. */
async function axeViolations(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	// Returned rather than asserted here, so each test carries its own assertion.
	return results.violations;
}

/** Take the two-day template, which is the shortest route to a routine. */
async function pickFullBody(page: Page) {
	await page.getByRole('button', { name: /Full body/ }).click();
	await expect(page.getByRole('heading', { name: 'Exercise', level: 1 })).toBeVisible();
}

test.describe('with nothing planned yet', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await onboard(page, baseURL ?? '');
	});

	test('offers starting points rather than an empty page', async ({ page }) => {
		await expect(page.getByRole('button', { name: /Full body/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Build one from scratch' })).toBeVisible();
	});

	test('has no detectable accessibility violations', async ({ page }) => {
		expect(await axeViolations(page)).toEqual([]);
	});

	test('a template leaves a routine in the rotation', async ({ page }) => {
		await pickFullBody(page);
		await expect(page.getByRole('link', { name: /Full body/ })).toBeVisible();
		await expect(page.getByText('1 in rotation')).toBeVisible();
	});

	test('building from scratch opens the builder', async ({ page }) => {
		await page.getByRole('button', { name: 'Build one from scratch' }).click();
		await expect(page.getByRole('button', { name: 'Add from library' })).toBeVisible();
	});
});

test.describe('once a routine is in the rotation', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await onboard(page, baseURL ?? '');
		await pickFullBody(page);
	});

	test('runs a session and files what was done', async ({ page }) => {
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();

		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await expect(page.getByRole('button', { name: 'Set 1 done' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await page.getByRole('button', { name: 'Finish' }).click();
		await expect(page.getByRole('heading', { name: 'Full body', level: 1 })).toBeVisible();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'What you did' })).toBeVisible();
	});

	test('keeps a session running across a reload', async ({ page }) => {
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.reload();
		await expect(page.getByRole('button', { name: 'Set 1 done' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('opens the routine as a sheet, grouped by muscle', async ({ page }) => {
		await page.getByRole('link', { name: /Full body/ }).click();
		await expect(page.getByText('Legs', { exact: true }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start this session' })).toBeVisible();
	});

	// A day taking a second routine needs a rotation with two in it, so that flow
	// is exercised end to end in `phone-layout.e2e.ts` against the three-routine
	// starter. This one is the single-routine path and says only that.
	test('puts a routine on a day from the week view', async ({ page }) => {
		await page.getByRole('link', { name: 'Plan', exact: true }).click();
		await expect(page.getByRole('link', { name: 'Year' })).toBeVisible();

		await page.getByRole('button', { name: /^Mon / }).click();
		await page.getByRole('button', { name: /Full body/ }).click();
		await expect(page.getByText('Session 1 of the day')).toBeVisible();
		await page.getByRole('button', { name: 'Close' }).click();

		await expect(page.getByRole('button', { name: /^Mon .*Full body/ })).toBeVisible();
		await expect(page.getByText('1 of 7 days planned')).toBeVisible();

		// The year view counts the week the day sits in, and leads back into it.
		await page.getByRole('link', { name: 'Year' }).click();
		await expect(page.getByText(/1\/52 planned/)).toBeVisible();
	});

	test('reaches training progress, which waits for a finished session', async ({ page }) => {
		await page.getByRole('link', { name: 'Training progress' }).click();
		await expect(page.getByText(/nothing here to chart/)).toBeVisible();
	});

	test('has no detectable accessibility violations on the rotation', async ({ page }) => {
		expect(await axeViolations(page)).toEqual([]);
	});

	test('has no detectable accessibility violations mid-session', async ({ page }) => {
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		expect(await axeViolations(page)).toEqual([]);
	});

	test('has no detectable accessibility violations on the routine sheet', async ({ page }) => {
		await page.getByRole('link', { name: /Full body/ }).click();
		await expect(page.getByRole('button', { name: 'Start this session' })).toBeVisible();
		expect(await axeViolations(page)).toEqual([]);
	});

	test('has no detectable accessibility violations in the library', async ({ page }) => {
		// Each screen is waited for before the next click. The rotation's `Plan`
		// button and the routine sheet's `Edit` sit in the same top-right slot, so
		// a click dispatched while the first navigation is still settling lands on
		// the wrong one and ends up on the planner.
		await page.getByRole('link', { name: /Full body/ }).click();
		await expect(page.getByRole('button', { name: 'Start this session' })).toBeVisible();
		await page.getByRole('link', { name: 'Edit' }).click();
		await expect(page.getByRole('button', { name: 'Add from library' })).toBeVisible();
		await page.getByRole('button', { name: 'Add from library' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		expect(await axeViolations(page)).toEqual([]);
	});

	test('has no detectable accessibility violations while planning', async ({ page }) => {
		await page.getByRole('link', { name: 'Plan', exact: true }).click();
		await expect(page.getByRole('button', { name: /^Mon / })).toBeVisible();
		expect(await axeViolations(page)).toEqual([]);
	});

	test('has no detectable accessibility violations picking a day', async ({ page }) => {
		await page.getByRole('link', { name: 'Plan', exact: true }).click();
		await page.getByRole('button', { name: /^Mon / }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		expect(await axeViolations(page)).toEqual([]);
	});

	test('has no detectable accessibility violations on the year', async ({ page }) => {
		await page.getByRole('link', { name: 'Plan', exact: true }).click();
		await page.getByRole('link', { name: 'Year' }).click();
		await expect(page.getByRole('link', { name: /^Week 40/ })).toBeVisible();
		expect(await axeViolations(page)).toEqual([]);
	});

	test('has no detectable accessibility violations reading progress back', async ({ page }) => {
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.getByRole('button', { name: 'Finish' }).click();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
		expect(await axeViolations(page)).toEqual([]);
		await page.getByRole('link', { name: 'See training progress' }).click();
		await expect(page.getByText(/top set/)).toBeVisible();
		expect(await axeViolations(page)).toEqual([]);
	});
});

/**
 * A session with no ticks is still filed, so the summary renders — but it is
 * not counted as this week's training. The clock is pinned to a Tuesday and the
 * routine is put on the Wednesday, so "not counted" is the real assertion; on a
 * planned day it would be vacuous.
 */
test.describe('a session where nothing was ticked', () => {
	/** Tuesday, week 1 of 2026. */
	const TUESDAY = new Date('2026-01-06T09:00:00');

	test.beforeEach(async ({ page, baseURL }) => {
		await page.clock.setFixedTime(TUESDAY);
		await onboard(page, baseURL ?? '');
		await pickFullBody(page);
		// Wednesday, so today is deliberately a rest day rather than an unplanned one.
		await page.getByRole('link', { name: 'Plan', exact: true }).click();
		await page.getByRole('button', { name: /^Wed / }).click();
		await page.getByRole('button', { name: /Full body/ }).click();
		await page.getByRole('button', { name: 'Close' }).click();
		await page.getByRole('link', { name: 'Back' }).click();
		await expect(page.getByRole('heading', { name: 'Exercise', level: 1 })).toBeVisible();
	});

	test('is filed, and the summary says so kindly', async ({ page }) => {
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();

		await page.getByRole('button', { name: 'Finish' }).click();

		// The summary, not the home screen: the session happened and was filed.
		await expect(page.getByRole('heading', { name: 'Full body', level: 1 })).toBeVisible();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
		await expect(
			page.getByText('Nothing logged this time. Showing up counts; the numbers can wait.')
		).toBeVisible();
		// The sentence and nothing else: a page of zeroes beside it would take the
		// kindness back, and the only thing left to do is leave.
		await expect(page.getByText('Sets done')).toHaveCount(0);
		await expect(page.getByText('not done')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'See training progress' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Done' })).toBeVisible();
	});

	test('does not count as this week’s training', async ({ page }) => {
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await page.getByRole('button', { name: 'Finish' }).click();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Done', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'Rest day', level: 2 })).toBeVisible();
		await expect(page.getByText('The calendar has nothing scheduled.')).toBeVisible();
		await expect(page.getByText(/done this week already/)).toHaveCount(0);
		await expect(page.getByRole('link', { name: /trained$/ })).toHaveCount(0);

		// One set ticked later the same screen counts it — a rule at work, not a dead card.
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.getByRole('button', { name: 'Finish' }).click();
		await page.getByRole('link', { name: 'Done', exact: true }).click();
		await expect(page.getByText(/1 session done this week already/)).toBeVisible();
	});
});
