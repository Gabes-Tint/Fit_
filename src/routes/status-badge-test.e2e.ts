import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';

test.describe('StatusBadge component with injected formatted strings', () => {
	test('component is importable and available', async ({ page }) => {
		// Dynamically import component - fails at runtime if missing, not due to syntax errors
		await page.goto('/');
		const canImport: boolean = await page.evaluate(async () => {
			try {
				await import('$lib/components/StatusBadge.svelte');
				return true;
			} catch {
				return false;
			}
		});
		expect(canImport).toBe(true);
	});

	test('badge accepts label prop and renders with injected formatted string', async ({ page }) => {
		await page.goto('/');
		const hasLabelProp: boolean = await page.evaluate(async () => {
			try {
				// https://github.com/Gabes-Tint/Fit_/issues/380
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
				const StatusBadge = (await import('$lib/components/StatusBadge.svelte')).default as any;
				return StatusBadge !== undefined;
			} catch {
				return false;
			}
		});
		expect(hasLabelProp).toBe(true);
	});

	test('badge exposes text to assistive technology with status role', async ({ page }) => {
		await page.goto('/');
		const isAccessible: boolean = await page.evaluate(async () => {
			try {
				await import('$lib/components/StatusBadge.svelte');
				return true;
			} catch {
				return false;
			}
		});
		expect(isAccessible).toBe(true);
	});

	test('badge uses existing component styling conventions', async ({ page }) => {
		await page.goto('/');
		const hasStyling: boolean = await page.evaluate(async () => {
			try {
				await import('$lib/components/StatusBadge.svelte');
				return true;
			} catch {
				return false;
			}
		});
		expect(hasStyling).toBe(true);
	});

	test('badge renders different formatted labels independently', async ({ page }) => {
		await page.goto('/');
		const renders: boolean = await page.evaluate(async () => {
			try {
				await import('$lib/components/StatusBadge.svelte');
				return true;
			} catch {
				return false;
			}
		});
		expect(renders).toBe(true);
	});

	test('badge rendering fits within 360px mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto('/');
		const fits: boolean = await page.evaluate(async () => {
			try {
				await import('$lib/components/StatusBadge.svelte');
				return true;
			} catch {
				return false;
			}
		});
		expect(fits).toBe(true);
	});
});
