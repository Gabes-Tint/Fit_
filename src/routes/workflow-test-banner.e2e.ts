import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { atNarrowPhone, expectFitsViewport, signInThroughApi } from '../../tests/e2e-support';

test.describe('workflow test banner', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
	});

	test('banner text is initially visible on the home route', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Workflow UI-only test banner')).toBeVisible();
	});

	test('activating the dismiss button hides the banner', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Workflow UI-only test banner')).toBeVisible();
		await page.getByRole('button', { name: 'Dismiss workflow test banner' }).click();
		await expect(page.getByText('Workflow UI-only test banner')).toBeHidden();
	});

	test('banner stays hidden for the remainder of the current page session', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByText('Workflow UI-only test banner')).toBeVisible();
		await page.getByRole('button', { name: 'Dismiss workflow test banner' }).click();
		await expect(page.getByText('Workflow UI-only test banner')).toBeHidden();
		await page.reload();
		await expect(page.getByText('Workflow UI-only test banner')).toBeHidden();
	});

	test('the banner stays inside the viewport at 360px', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await atNarrowPhone(page);
		await expect(page.getByText('Workflow UI-only test banner')).toBeVisible();
		await expectFitsViewport(page, page.getByText('Workflow UI-only test banner'));
	});
});
