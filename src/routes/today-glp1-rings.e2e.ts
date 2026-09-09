import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { atNarrowPhone, expectFitsViewport, signInThroughApi } from '../../tests/e2e-support';

/**
 * GLP-1 mode replaces the three side-by-side Protein/Fiber/Energy rings with
 * one concentric cluster (#glp1-concentric-rings). This only exercises that
 * the cluster reaches the Today page and reveals a ring on tap — the
 * component spec (`GlpRingCluster.svelte.spec.ts`) covers the cycling and
 * aria-label in detail.
 */
async function onboardIntoGlp1(page: Page, baseURL: string) {
	await signInThroughApi(page, baseURL);
	await page.goto('/');

	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByRole('switch', { name: 'GLP-1 mode' }).click();
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByRole('button', { name: 'Start empty' }).click();
	await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

test.describe('GLP-1 ring cluster on Today', () => {
	test('renders the cluster, and tapping cycles Energy then Protein', async ({ page, baseURL }) => {
		await onboardIntoGlp1(page, baseURL ?? '');

		const cluster = page.getByRole('button', { name: /Energy 0 of \d+\s*kcal/ });
		await expect(cluster).toBeVisible();
		await expect(cluster).toHaveText('');

		await cluster.click();
		await expect(cluster).toContainText('Energy');
		await expect(cluster).toContainText(/of \d+\s*kcal/);

		await cluster.click();
		await expect(cluster).toContainText('Protein');
		await expect(cluster).toContainText(/of \d+\s*g/);
	});

	test.describe('at 360px', () => {
		test('the ring cluster card stays inside the viewport', async ({ page, baseURL }) => {
			await onboardIntoGlp1(page, baseURL ?? '');
			await atNarrowPhone(page);

			const cluster = page.getByRole('button', { name: /Energy 0 of \d+\s*kcal/ });
			const card = cluster.locator('xpath=ancestor::section[1]');
			await expectFitsViewport(page, card);
		});
	});
});
