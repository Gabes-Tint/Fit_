import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openSampleJournal, signInThroughApi, expectFitsViewport } from '../../tests/e2e-support';

test.describe('Training audit summary on home route', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openSampleJournal(page);
	});

	test('displays an accessible element named "Training audit summary"', async ({ page }) => {
		await expect(page.getByRole('region', { name: 'Training audit summary' })).toBeVisible();
	});

	test('displays formatted exercise summary in the training audit element', async ({ page }) => {
		const auditElement = page.getByRole('region', { name: 'Training audit summary' });
		await expect(auditElement).toBeVisible();
		await expect(auditElement).toContainText('·');
	});

	test('fits within the 360px viewport', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 640 });
		await expectFitsViewport(page);
	});
});
