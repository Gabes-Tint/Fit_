import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { signInThroughApi, openSampleJournal } from '../../tests/e2e-support';

test.describe('Training audit summary on home route', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openSampleJournal(page);
		await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
	});

	test('training audit summary is present and accessible', async ({ page }) => {
		const summary = page.getByRole('region', { name: 'Training audit summary' });
		// Locator must match exactly one element on the page
		await expect(summary).toHaveCount(1);
		// And it must be visible to the user
		await expect(summary.first()).toBeVisible();
	});

	test('training audit summary displays formatted exercise and rounds', async ({ page }) => {
		const summary = page.getByRole('region', { name: 'Training audit summary' });
		// Must contain the centered dot separator and round count
		await expect(summary.first()).toContainText('·');
	});
});
