import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	EGG_ROW,
	expectFitsViewport,
	openLogSheetAndType,
	openSampleJournal,
	signInThroughApi,
	stubFoodResolve
} from '../../tests/e2e-support';
import AxeBuilder from '@axe-core/playwright';

test.describe('arriving without an account', () => {
	test('opens on the sign-in form rather than on the app', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
	});

	test('shows nothing of the app behind it', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
		// Counted rather than checked for visibility: these must be absent from
		// the page, and `toBeHidden` would also pass for an element that is
		// present and merely off screen.
		await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Log food' })).toHaveCount(0);
	});

	test('gates onboarding too, so the account comes first', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Tend' })).toHaveCount(0);
	});

	test('gates a destination reached directly, and remembers which', async ({ page }) => {
		await page.goto('/progress');
		await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
		await expect(page).toHaveURL(`/signin?next=${encodeURIComponent('/progress')}`);
	});

	test('offers the way to create one', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Create one' }).click();
		await expect(page.getByRole('heading', { name: 'Create an account', level: 1 })).toBeVisible();
	});

	test('has no detectable accessibility violations', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(results.violations).toEqual([]);
	});
});

test.describe('first visit, signed in', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
	});

	test('opens on the welcome step', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Tend' })).toBeVisible();
	});

	test('leads with the promise that a missed day is fine', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('No red days.')).toBeVisible();
	});

	test('has no detectable accessibility violations', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Tend' })).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(results.violations).toEqual([]);
	});
});

test.describe('once onboarded', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await openSampleJournal(page);
	});

	test('shows today with the day’s log', async ({ page }) => {
		await expect(page.getByRole('heading', { name: 'breakfast' })).toBeVisible();
	});

	/**
	 * The weight graph moved here from Progress so a trend is visible without
	 * leaving the day. The sample journal seeds enough weigh-ins to draw a
	 * line, so its accessible name carries the "Weight trend" caption instead
	 * of the empty-state invitation.
	 */
	test('plots the weight trend directly under the Energy card', async ({ page }) => {
		const energyCard = page.getByText(/of \d+\s*kcal/).first();
		await expect(energyCard).toBeVisible();
		const weightSection = page.getByRole('region', { name: 'Weight' });
		const chart = weightSection.getByRole('img', { name: /Weight trend/ });
		await expect(chart).toBeVisible();
		// Proves adjacency rather than "somewhere below": the weight section's
		// immediately preceding sibling in the DOM must be the Energy card's own
		// section, not just any section above it.
		const precedingSection = weightSection.locator('xpath=preceding-sibling::section[1]');
		await expect(precedingSection.getByText(/of \d+\s*kcal/).first()).toBeVisible();
	});

	test('keeps the destinations behind the menu button', async ({ page }) => {
		await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Progress' })).toBeHidden();
	});

	test('marks the current destination in the navigation', async ({ page }) => {
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
	});

	test('has no detectable accessibility violations with the menu open', async ({ page }) => {
		// The sample journal seeded in beforeEach triggers a sync save, and
		// SyncStatusBadge fades its "Saving..." status in and out over 150ms.
		// A scan mid-fade can catch its text at a partially transparent, low
		// contrast opacity rather than its resting color, so settle it first.
		await expect(page.getByRole('status')).toHaveText('');
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(results.violations).toEqual([]);
	});

	test('names each destination in the browser tab', async ({ page }) => {
		await expect(page).toHaveTitle('Today · Fit_');
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Plan' }).click();
		await expect(page).toHaveTitle('Plan · Fit_');
	});

	test('navigates to progress and moves the current marker', async ({ page }) => {
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Progress' }).click();
		await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('link', { name: 'Progress' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	});

	test('closes the menu once a destination is reached', async ({ page }) => {
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Plan' }).click();
		await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
		await expect(page.getByRole('dialog')).toBeHidden();
	});

	test('navigates to exercise, which opens on the starting points', async ({ page }) => {
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'Exercise' }).click();
		// Sample journal has no training data; Exercise shows its first-run picker.
		await expect(page.getByRole('heading', { name: 'Nothing here yet', level: 1 })).toBeVisible();
	});

	test('navigates to the profile', async ({ page }) => {
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'You' }).click();
		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();
	});

	test('reaches the photo tab from the log sheet', async ({ page }) => {
		await page.getByRole('button', { name: 'Log food' }).first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('button', { name: 'Photo', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Photo', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('offers the gallery as its own way in, beside the camera', async ({ page }) => {
		await page.getByRole('button', { name: 'Log food' }).first().click();
		await page.getByRole('button', { name: 'Upload' }).click();
		await expect(page.getByRole('button', { name: 'Choose a picture' })).toBeVisible();
	});

	test('offers typing as the way out of the photo tab', async ({ page }) => {
		await page.getByRole('button', { name: 'Log food' }).first().click();
		await page.getByRole('button', { name: 'Photo', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Type it instead' })).toBeVisible();
	});

	test('opens the sheet on the meal named by its own heading button', async ({ page }) => {
		await page.getByRole('button', { name: 'Log lunch' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.getByRole('button', { name: 'lunch', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('logs a food through the sheet', async ({ page }) => {
		await stubFoodResolve(page, [EGG_ROW]);
		await openLogSheetAndType(page, 'two eggs');
		await page.getByRole('button', { name: 'Parse' }).click();
		await page.getByRole('button', { name: 'Add to today' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
	});

	test('keeps the journal across a reload', async ({ page }) => {
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
	});

	test('day strip scrolls on its own, centers Today, and reveals dated pills further back', async ({
		page
	}) => {
		const strip = page.getByRole('button', { name: /^Today/ }).locator('xpath=..');
		const stripMetrics = await strip.evaluate((el) => ({
			scrollWidth: el.scrollWidth,
			clientWidth: el.clientWidth
		}));
		expect(stripMetrics.scrollWidth).toBeGreaterThan(stripMetrics.clientWidth);

		const viewportWidth = page.viewportSize()?.width ?? 0;
		await expectFitsViewport(page);

		const todayBox = await page.getByRole('button', { name: /^Today/ }).boundingBox();
		expect(todayBox).not.toBeNull();
		const todayCenterX =
			(todayBox as { x: number; width: number }).x + (todayBox as { width: number }).width / 2;
		expect(Math.abs(todayCenterX - viewportWidth / 2)).toBeLessThanOrEqual(8);

		await strip.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
		await expect(strip.getByText(/^\w{3} \d{1,2}$/).first()).toBeVisible();
	});
});
