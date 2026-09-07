import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { NutritionFactRow } from '$lib/domain/nutrition-facts';
import NutritionFactsSheet from './NutritionFactsSheet.svelte';

const ROWS: NutritionFactRow[] = [
	{ key: 'kcal', label: 'Calories', value: 300, unit: 'kcal' },
	{ key: 'sodium', label: 'Sodium', value: 450.5, unit: 'mg' },
	{ key: 'potassium', label: 'Potassium', value: null, unit: 'mg' }
];

describe('NutritionFactsSheet', () => {
	it('titles the sheet with the food name and shows the serving as its description', async () => {
		await render(NutritionFactsSheet, {
			props: { open: true, name: 'Big Mac', servingLabel: '1 sandwich (219 g)', rows: ROWS }
		});
		await expect.element(page.getByRole('heading', { name: 'Big Mac' })).toBeInTheDocument();
		await expect.element(page.getByText('1 sandwich (219 g)')).toBeInTheDocument();
	});

	it('shows every row’s label and its value with its unit', async () => {
		await render(NutritionFactsSheet, {
			props: { open: true, name: 'Big Mac', servingLabel: '1 sandwich', rows: ROWS }
		});
		await expect.element(page.getByText('Sodium')).toBeInTheDocument();
		await expect.element(page.getByText('450.5 mg')).toBeInTheDocument();
	});

	it('shows an em dash rather than a zero for a nutrient the catalog never reported', async () => {
		await render(NutritionFactsSheet, {
			props: { open: true, name: 'Big Mac', servingLabel: '1 sandwich', rows: ROWS }
		});
		await expect.element(page.getByText('—')).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('Potassium0');
	});

	it('renders nothing when closed', async () => {
		await render(NutritionFactsSheet, {
			props: { open: false, name: 'Big Mac', servingLabel: '1 sandwich', rows: ROWS }
		});
		expect(document.body.textContent).not.toContain('Sodium');
	});

	it('closes on Escape', async () => {
		const props = $state({ open: true, name: 'Big Mac', servingLabel: '1 sandwich', rows: ROWS });
		await render(NutritionFactsSheet, { props });
		// Click a specific text node, not the dialog's geometric centre — a
		// container click can land on whatever future markup ends up centred,
		// including a real link (see #196).
		await page.getByText('Sodium', { exact: true }).click();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await vi.waitFor(() => expect(props.open).toBe(false));
	});
});
