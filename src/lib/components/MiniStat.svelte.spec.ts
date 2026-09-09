import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import MiniStat from './MiniStat.svelte';

describe('MiniStat', () => {
	it('shows the label', async () => {
		await render(MiniStat, { props: { label: 'Protein', value: 50, target: 120, unit: 'g' } });
		await expect.element(page.getByText('Protein')).toBeInTheDocument();
	});

	it('shows progress against the target', async () => {
		await render(MiniStat, { props: { label: 'Protein', value: 50.4, target: 120, unit: 'g' } });
		await expect.element(page.getByText('50/120 g')).toBeInTheDocument();
	});

	it('caps the bar at the target rather than overflowing', async () => {
		await render(MiniStat, {
			props: { label: 'Protein', value: 500, target: 100, unit: 'g' }
		});
		expect(document.body.querySelector<HTMLElement>('.bg-primary')?.style.width).toBe('100%');
	});

	it('shows an empty bar when nothing has been logged', async () => {
		await render(MiniStat, { props: { label: 'Protein', value: 0, target: 120, unit: 'g' } });
		expect(document.body.querySelector<HTMLElement>('.bg-primary')?.style.width).toBe('0%');
	});

	it('shows a partial bar part-way to the target', async () => {
		await render(MiniStat, { props: { label: 'Protein', value: 60, target: 120, unit: 'g' } });
		expect(document.body.querySelector<HTMLElement>('.bg-primary')?.style.width).toBe('50%');
	});

	it('shows an empty bar for a zero target rather than dividing by zero', async () => {
		await render(MiniStat, {
			props: { label: 'Protein', value: 50, target: 0, unit: 'g' }
		});
		expect(document.body.querySelector<HTMLElement>('.bg-primary')?.style.width).toBe('0%');
	});

	it('moves the bar when the value changes', async () => {
		const props = $state({ label: 'Protein', value: 0, target: 120, unit: 'g' });
		await render(MiniStat, { props });
		props.value = 60;
		await expect.element(page.getByText('60/120 g')).toBeInTheDocument();
		expect(document.body.querySelector<HTMLElement>('.bg-primary')?.style.width).toBe('50%');
	});

	it('keeps a gap between the label and the value so they cannot touch', async () => {
		// Regression: `flex justify-between` with no `gap` let a short label and a
		// wide value abut directly at narrow widths — rendering "Protein73/80 g".
		await render(MiniStat, { props: { label: 'Protein', value: 73, target: 80, unit: 'g' } });
		const row = document.body.querySelector<HTMLElement>('.justify-between');
		expect(row?.className).toMatch(/\bgap-\d/);
	});

	it('keeps the value from shrinking so it never wraps mid-number', async () => {
		await render(MiniStat, { props: { label: 'Protein', value: 73, target: 80, unit: 'g' } });
		await expect.element(page.getByText('73/80 g')).toHaveClass(/shrink-0/);
	});

	it('defaults the bar fill to bg-primary when no colour is given', async () => {
		await render(MiniStat, { props: { label: 'Protein', value: 50, target: 120, unit: 'g' } });
		expect(document.body.querySelector('.bg-primary')).not.toBeNull();
	});

	it('colours the bar fill from the color prop instead of the default', async () => {
		await render(MiniStat, {
			props: { label: 'Protein', value: 50, target: 120, unit: 'g', color: 'bg-destructive' }
		});
		expect(document.body.querySelector('.bg-destructive')).not.toBeNull();
		expect(document.body.querySelector('.bg-primary')).toBeNull();
	});
});
