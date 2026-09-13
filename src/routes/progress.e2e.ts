import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, signInThroughApi } from '../../tests/e2e-support';

/**
 * The Weight block has been removed from /progress. The page now shows only
 * PageHeader, Adaptive TDEE section, weekly averages, and micronutrients.
 * These tests verify the removal is complete.
 */

async function openProgress(page: Page) {
	await page.goto('/progress');
	await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
}

test.describe('Progress page without Weight block', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
	});

	test('displays PageHeader, Adaptive TDEE, and micronutrients sections', async ({ page }) => {
		await openProgress(page);

		// PageHeader is present
		await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
		await expect(page.getByText('Trend, not a streak')).toBeVisible();

		// Adaptive TDEE section is present
		await expect(page.getByRole('heading', { name: 'Adaptive TDEE', level: 2 })).toBeVisible();

		// Weekly averages section is present
		await expect(
			page.getByRole('heading', { name: "This week's average", level: 2 })
		).toBeVisible();

		// Micronutrients section is present
		await expect(page.getByRole('heading', { name: 'Micronutrients', level: 2 })).toBeVisible();
	});

	test('does not display the Weight heading', async ({ page }) => {
		await openProgress(page);

		// Weight heading should not exist
		const weightHeadings = page.getByRole('heading', { name: 'Weight' });
		await expect(weightHeadings).toHaveCount(0);
	});

	test('does not display weight entry inputs', async ({ page }) => {
		await openProgress(page);

		// Weight input fields should not exist
		const weightInputsKg = page.getByLabel('Weight in kilograms');
		const weightInputsLb = page.getByLabel('Weight in pounds');

		await expect(weightInputsKg).toHaveCount(0);
		await expect(weightInputsLb).toHaveCount(0);
	});

	test('does not display weight entry date buttons', async ({ page }) => {
		await openProgress(page);

		// The date buttons used by WeightEntry should not be present on this page
		// This assertion checks that there are no "Today", "Yesterday", "2 days ago"
		// buttons specific to weight entry (they may exist elsewhere on the page)
		const section = page
			.getByRole('region')
			.filter({ has: page.getByRole('heading', { name: 'Weight' }) });
		await expect(section).toHaveCount(0);
	});
});
