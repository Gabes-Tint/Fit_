import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import MacroRing from './MacroRing.svelte';

describe('MacroRing', () => {
	it('shows the rounded current value', async () => {
		await render(MacroRing, {
			props: { value: 87.4, target: 120, label: 'Protein', unit: 'g' }
		});
		await expect.element(page.getByText('87')).toBeInTheDocument();
	});

	it('shows the target and unit', async () => {
		await render(MacroRing, {
			props: { value: 87, target: 120, label: 'Protein', unit: 'g' }
		});
		await expect.element(page.getByText('of 120 g')).toBeInTheDocument();
	});

	it('shows the label', async () => {
		await render(MacroRing, {
			props: { value: 10, target: 100, label: 'Fiber', unit: 'g' }
		});
		await expect.element(page.getByText('Fiber')).toBeInTheDocument();
	});

	it('renders no label paragraph when none is given', async () => {
		await render(MacroRing, {
			props: { value: 10, target: 100, unit: 'kcal' }
		});
		await expect.element(page.getByText('10', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('of 100 kcal')).toBeInTheDocument();
		expect(document.querySelectorAll('p')).toHaveLength(0);
	});

	it('draws a heavier ring when emphasized', async () => {
		await render(MacroRing, {
			props: { value: 50, target: 100, label: 'Protein', unit: 'g', emphasis: true }
		});
		expect(document.querySelectorAll('circle')[1]?.getAttribute('stroke-width')).toBe('10');
	});

	it('draws a lighter ring when not emphasized', async () => {
		await render(MacroRing, { props: { value: 50, target: 100, label: 'Protein', unit: 'g' } });
		expect(document.querySelectorAll('circle')[1]?.getAttribute('stroke-width')).toBe('8');
	});

	it('honours a custom size', async () => {
		await render(MacroRing, {
			props: { value: 50, target: 100, label: 'Protein', unit: 'g', size: 96 }
		});
		expect(document.querySelector('svg')?.getAttribute('width')).toBe('96');
	});

	it('does not divide by a zero target', async () => {
		await render(MacroRing, {
			props: { value: 50, target: 0, label: 'Energy', unit: 'kcal' }
		});
		await expect.element(page.getByText('of 0 kcal')).toBeInTheDocument();
	});

	it('redraws when the value changes', async () => {
		const props = $state({ value: 10, target: 100, label: 'Energy', unit: 'kcal' });
		await render(MacroRing, { props });
		props.value = 90;
		await expect.element(page.getByText('90')).toBeInTheDocument();
	});

	it('resizes when the size changes', async () => {
		const props = $state({ value: 10, target: 100, label: 'Energy', unit: 'kcal', size: 132 });
		await render(MacroRing, { props });
		props.size = 96;
		await expect.element(page.getByText('10', { exact: true })).toBeInTheDocument();
		expect(document.querySelector('svg')?.getAttribute('width')).toBe('96');
	});

	it('draws the track in --color-secondary and the progress arc in --color-primary', async () => {
		// Regression: the ring used to be drawn by a shared RingArc component;
		// folding that arc math back into MacroRing must keep the same two
		// colors, in the same track-then-progress order (#glp1-one-ring).
		await render(MacroRing, {
			props: { value: 50, target: 100, label: 'Protein', unit: 'g' }
		});
		const circles = document.querySelectorAll('circle');
		expect(circles[0]?.getAttribute('stroke')).toBe('var(--color-secondary)');
		expect(circles[1]?.getAttribute('stroke')).toBe('var(--color-primary)');
	});
});
