import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { signInThroughApi, openSampleJournal, expectFitsViewport } from '../../tests/e2e-support';

test.describe('Training audit summary on home route', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openSampleJournal(page);
		await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
	});

	test('element with accessible name "Training audit summary" exists', async ({ page }) => {
		const auditElement = page.getByRole('region', { name: 'Training audit summary' });
		await expect(auditElement).toHaveCount(1);
	});

	test('displays "Deadlift · 4 rounds" format when exercise and rounds are provided', async ({
		page
	}) => {
		const auditElement = page.getByRole('region', { name: 'Training audit summary' });
		await expect(auditElement).toContainText(/Deadlift\s+·\s+\d+\s+rounds?/);
	});

	test('fits within 360px viewport', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 640 });
		const auditElement = page.getByRole('region', { name: 'Training audit summary' });
		await expectFitsViewport(page, auditElement);
	});
});
