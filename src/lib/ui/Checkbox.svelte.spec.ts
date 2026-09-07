import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Checkbox from './Checkbox.svelte';

describe('Checkbox', () => {
	it('is unchecked by default', async () => {
		await render(Checkbox, { props: { 'aria-label': 'Oats in pantry' } });
		await expect
			.element(page.getByRole('checkbox', { name: 'Oats in pantry' }))
			.toHaveAttribute('data-state', 'unchecked');
	});

	it('shows a tick when checked', async () => {
		await render(Checkbox, { props: { checked: true, 'aria-label': 'Oats in pantry' } });
		expect(
			page.getByRole('checkbox', { name: 'Oats in pantry' }).element().querySelector('svg')
		).not.toBeNull();
	});

	it('shows no tick when unchecked', async () => {
		await render(Checkbox, { props: { checked: false, 'aria-label': 'Oats in pantry' } });
		expect(
			page.getByRole('checkbox', { name: 'Oats in pantry' }).element().querySelector('svg')
		).toBeNull();
	});

	it('writes a tick back to the caller', async () => {
		const props = $state({ checked: false, 'aria-label': 'Oats in pantry' });
		await render(Checkbox, { props });
		await page.getByRole('checkbox', { name: 'Oats in pantry' }).click();
		expect(props.checked).toBe(true);
	});

	it('clears again', async () => {
		const props = $state({ checked: true, 'aria-label': 'Oats in pantry' });
		await render(Checkbox, { props });
		await page.getByRole('checkbox', { name: 'Oats in pantry' }).click();
		expect(props.checked).toBe(false);
	});
});
