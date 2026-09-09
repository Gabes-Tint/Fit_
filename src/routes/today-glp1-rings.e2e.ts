import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { signInThroughApi } from '../../tests/e2e-support';

/**
 * GLP-1 mode replaces the three side-by-side Protein/Fiber/Energy rings with
 * one concentric cluster (#glp1-concentric-rings). This only exercises that
 * the cluster reaches the Today page and reveals a ring on tap — the
 * component spec (`GlpRingCluster.svelte.spec.ts`) covers the cycling and
 * aria-label in detail.
 */
test.describe('GLP-1 ring cluster on Today', () => {
	test('renders the cluster and a tap reveals Energy', async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');

		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('switch', { name: 'GLP-1 mode' }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

		const cluster = page.getByRole('button', { name: /Energy 0 of \d+\s*kcal/ });
		await expect(cluster).toBeVisible();
		await expect(cluster).toHaveText('');

		await cluster.click();
		await expect(cluster).toContainText('Energy');
		await expect(cluster).toContainText(/of \d+\s*kcal/);
	});
});
