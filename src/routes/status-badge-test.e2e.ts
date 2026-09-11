import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { expectFitsViewport } from '../../tests/e2e-support';

test.describe('StatusBadge component', () => {
	test('renders the provided label as text', async ({ page }) => {
		await page.goto('/status-badge-test?label=In+Progress');
		await expect(page.getByText('In Progress')).toBeVisible();
	});

	test('renders a visible badge element with status role', async ({ page }) => {
		await page.goto('/status-badge-test?label=Completed');
		const badge = page.getByRole('status');
		await expect(badge).toBeVisible();
	});

	test('exposes the label text to assistive technology', async ({ page }) => {
		await page.goto('/status-badge-test?label=Active');
		const badge = page.getByRole('status', { name: 'Active' });
		await expect(badge).toBeVisible();
	});

	test('uses existing component styling conventions', async ({ page }) => {
		await page.goto('/status-badge-test?label=Ready');
		const badge = page.getByRole('status');
		// Verify badge has Tailwind classes for badge styling (rounded, padding, etc)
		const classes = await badge.getAttribute('class');
		expect(classes).toMatch(/rounded|px|py|font-medium|bg-/);
	});

	test('renders different formatted labels correctly', async ({ page }) => {
		await page.goto('/status-badge-test?label=In+Review');
		await expect(page.getByText('In Review')).toBeVisible();
	});

	test('fits within the 360px mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto('/status-badge-test?label=Test+Badge');
		const badge = page.getByRole('status');
		await expectFitsViewport(page, badge);
	});

	test('badge is accessible and semantically correct', async ({ page }) => {
		await page.goto('/status-badge-test?label=Published');
		const status = page.getByRole('status');
		await expect(status).toHaveAttribute('role', 'status');
	});
});
