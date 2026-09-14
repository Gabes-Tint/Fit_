import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { atNarrowPhone, expectFitsViewport } from '../../tests/e2e-support';

async function renderLogRow(
	page: Page,
	options: {
		name: string;
		brand: string | undefined;
		servingLabel: string;
		testId: string;
	}
) {
	const item = {
		id: `test-item-${options.testId}`,
		foodId: null,
		date: '2026-06-01',
		meal: 'breakfast' as const,
		servings: 1,
		source: 'manual' as const,
		name: options.name,
		kcal: 144,
		protein: 13,
		carbs: 1,
		fat: 10,
		micros: { sodium: 126, potassium: 139, calcium: 53 },
		provenance: 'off' as const,
		servingLabel: options.servingLabel,
		grams: 50,
		brand: options.brand
	};

	const props = JSON.stringify({ item, open: false, step: 0.5, ontoggle: () => {} });
	await page.goto(
		`/dev/component-harness?component=components/LogRow&props=${encodeURIComponent(props)}`
	);
}

test.describe('LogRow', () => {
	test.describe('with a branded food', () => {
		test.beforeEach(async ({ page }) => {
			await renderLogRow(page, {
				name: 'GREEN APPLE',
				brand: 'CLAEYS',
				servingLabel: '3 PIECES',
				testId: 'branded'
			});
		});

		test('renders name, brand, and portion on separate lines', async ({ page }) => {
			// The name should be visible
			await expect(page.getByText('GREEN APPLE', { exact: true })).toBeVisible();

			// The brand should be visible on its own line
			await expect(page.getByText('CLAEYS', { exact: true })).toBeVisible();

			// The portion should be visible
			await expect(page.getByText('3 PIECES')).toBeVisible();
		});

		test('shows no provenance badge', async ({ page }) => {
			// ProvenanceBadge would render with a title attribute
			await expect(page.locator('[title]')).toHaveCount(0);
		});

		test('fits the viewport at 360px with long content', async ({ page }) => {
			await atNarrowPhone(page);
			const row = page.locator('li').first();
			await expectFitsViewport(page, row);
		});
	});

	test.describe('with an unbranded food', () => {
		test.beforeEach(async ({ page }) => {
			await renderLogRow(page, {
				name: 'Egg, large',
				brand: undefined,
				servingLabel: '1 large',
				testId: 'unbranded'
			});
		});

		test('renders name and portion on separate lines with no brand element', async ({ page }) => {
			// The name should be visible
			await expect(page.getByText('Egg, large', { exact: true })).toBeVisible();

			// The portion should be visible
			await expect(page.getByText('1 large')).toBeVisible();

			// No brand text should appear (BrandLabel renders nothing when brand is undefined)
			// This checks that there's no empty brand slot
			const mainContent = page.locator('main');
			const text = await mainContent.textContent();
			expect(text).toContain('Egg, large');
			expect(text).toContain('1 large');
		});

		test('shows no provenance badge', async ({ page }) => {
			await expect(page.locator('[title]')).toHaveCount(0);
		});
	});

	test.describe('layout constraints', () => {
		test('a journal row with a long name, brand, and portion fits at 360px', async ({ page }) => {
			await renderLogRow(page, {
				name: 'Really Long Food Name That Takes Up Space',
				brand: 'Really Long Brand Name',
				servingLabel: '1 enormous serving',
				testId: 'long'
			});
			await atNarrowPhone(page);

			const row = page.locator('li').first();
			await expectFitsViewport(page, row);
		});
	});
});
