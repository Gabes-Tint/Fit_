import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { WeightEntry } from '$lib/domain/types';
import WeightChart from './WeightChart.svelte';

function readings(kgs: number[]): WeightEntry[] {
	return kgs.map((kg, i) => ({ id: `w${i}`, date: `2026-06-0${i + 1}`, kg }));
}

describe('WeightChart', () => {
	it('invites a first weigh-in when there is no data', async () => {
		await render(WeightChart, { props: { weights: [] } });
		await expect.element(page.getByText(/Log a few weigh-ins/)).toBeInTheDocument();
	});

	it('still invites one when there is only a single reading to plot', async () => {
		await render(WeightChart, { props: { weights: readings([80]) } });
		await expect.element(page.getByText(/Log a few weigh-ins/)).toBeInTheDocument();
	});

	it('draws a line once there are two readings', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79]) } });
		expect(document.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
	});

	it('describes the trend for screen readers', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79]) } });
		expect(document.querySelector('svg')?.getAttribute('aria-label')).toMatch(/80 to 79/);
	});

	it('plots one point per reading', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79.5, 79]) } });
		expect(document.querySelector('path')?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(3);
	});

	it('sorts readings by date regardless of input order', async () => {
		const unsorted: WeightEntry[] = [
			{ id: 'b', date: '2026-06-05', kg: 79 },
			{ id: 'a', date: '2026-06-01', kg: 81 }
		];
		await render(WeightChart, { props: { weights: unsorted } });
		expect(document.querySelector('svg')?.getAttribute('aria-label')).toMatch(/81 to 79/);
	});

	it('does not collapse the plot when every reading is identical', async () => {
		await render(WeightChart, { props: { weights: readings([80, 80, 80]) } });
		expect(document.querySelector('path')?.getAttribute('d')).toBeTruthy();
	});

	it('reads the spoken trend in pounds when the preference is imperial', async () => {
		await render(WeightChart, {
			props: { weights: readings([80, 79]), units: 'imperial' }
		});
		const label = document.querySelector('svg')?.getAttribute('aria-label');
		expect(label).toMatch(/176\.4 to 174\.2 pounds/);
	});
});

describe('WeightChart scrubbing', () => {
	function svgRect(): DOMRect {
		const svg = document.querySelector('svg');
		if (!svg) throw new Error('no svg rendered');
		return svg.getBoundingClientRect();
	}

	function pointerAt(type: string, clientX: number, options: Partial<PointerEventInit> = {}) {
		const svg = document.querySelector('svg');
		if (!svg) throw new Error('no svg rendered');
		svg.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				clientX,
				clientY: svgRect().top + svgRect().height / 2,
				...options
			})
		);
	}

	/** The visible on-chart label, disambiguated from the sr-only live region carrying the same text. */
	function chartLabel(text: string) {
		return page.getByRole('img').getByText(text, { exact: true });
	}

	it('plots one dot per measurement point', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79.5, 79, 78.5]) } });
		await expect.element(page.getByRole('img')).toBeInTheDocument();
		expect(document.querySelectorAll('circle.dot')).toHaveLength(4);
	});

	it('selects the nearest point on pointermove and shows its date and weight', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'mouse' });
		pointerAt('pointermove', rect.left + rect.width - 1, { pointerType: 'mouse' });

		await expect.element(chartLabel('Jun 3 · 78.0 kg')).toBeInTheDocument();
	});

	it('clears the selection on pointerleave from a mouse', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'mouse' });
		await expect.element(chartLabel('Jun 3 · 78.0 kg')).toBeInTheDocument();

		pointerAt('pointerup', rect.left + rect.width - 1, { pointerType: 'mouse' });
		pointerAt('pointerleave', rect.left + rect.width - 1, { pointerType: 'mouse' });

		await expect.element(chartLabel('Jun 3 · 78.0 kg')).not.toBeInTheDocument();
	});

	it('clamps the label so it does not overflow the right edge when the nearest point is at the edge', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'mouse' });
		const label = chartLabel('Jun 3 · 78.0 kg');
		await expect.element(label).toBeInTheDocument();

		const labelBox = label.element().getBoundingClientRect();
		expect(labelBox.right).toBeLessThanOrEqual(rect.right + 1);
		expect(labelBox.left).toBeGreaterThanOrEqual(rect.left - 1);
	});

	it('describes the range on the root svg for screen readers', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const label = document.querySelector('svg')?.getAttribute('aria-label');
		expect(label).toMatch(/Weight trend from Jun 1 to Jun 3/);
		expect(label).toMatch(/80 to 78 kilograms/);
	});
});
