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

	it('ignores a pointermove or pointerup with no active pointer down', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		pointerAt('pointermove', rect.left + rect.width - 1, { pointerType: 'mouse' });
		pointerAt('pointerup', rect.left + rect.width - 1, { pointerType: 'mouse' });

		await expect
			.element(page.getByRole('img').getByText(/·/, { exact: false }))
			.not.toBeInTheDocument();
	});

	it('keeps the selection through a touch pointerup and a touch pointerleave', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'touch' });
		await expect.element(chartLabel('Jun 3 · 78.0 kg')).toBeInTheDocument();

		pointerAt('pointerup', rect.left + rect.width - 1, { pointerType: 'touch' });
		pointerAt('pointerleave', rect.left + rect.width - 1, { pointerType: 'touch' });

		await expect.element(chartLabel('Jun 3 · 78.0 kg')).toBeInTheDocument();
	});

	it('a new touch elsewhere on the chart replaces a lingering touch selection', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'touch' });
		pointerAt('pointerup', rect.left + rect.width - 1, { pointerType: 'touch' });
		await expect.element(chartLabel('Jun 3 · 78.0 kg')).toBeInTheDocument();

		pointerAt('pointerdown', rect.left + 1, { pointerType: 'touch', pointerId: 2 });
		await expect.element(chartLabel('Jun 1 · 80.0 kg')).toBeInTheDocument();
	});

	it('draws the guide line only while a point is selected', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();
		expect(document.querySelector('line.guide')).toBeNull();

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'mouse' });
		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).toBeInTheDocument();
		const guide = document.querySelector('line.guide');
		expect(guide).not.toBeNull();
		// It hangs from the top of the plot down to the selected point, on its x.
		expect(guide?.getAttribute('x1')).toBe(guide?.getAttribute('x2'));

		pointerAt('pointerup', rect.left + rect.width - 1, { pointerType: 'mouse' });
		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).not.toBeInTheDocument();
		expect(document.querySelector('line.guide')).toBeNull();
	});

	it('enlarges the selected dot and leaves the rest at their resting size', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();
		const radii = () =>
			[...document.querySelectorAll('circle.dot')].map((c) => c.getAttribute('r'));
		expect(radii()).toEqual(['2.5', '2.5', '2.5']);

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'mouse' });
		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).toBeInTheDocument();

		expect(radii()).toEqual(['2.5', '2.5', '5']);
	});

	it('announces the selected reading in the live region and empties it again', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();
		const live = () => document.querySelector('[aria-live="polite"]');
		expect(live()?.textContent).toBe('');

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'mouse' });
		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).toBeInTheDocument();
		expect(live()?.textContent).toBe('Jun 3 \u00b7 78.0 kg');

		pointerAt('pointerup', rect.left + rect.width - 1, { pointerType: 'mouse' });
		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).not.toBeInTheDocument();
		expect(live()?.textContent).toBe('');
	});

	it('releases the pointer on pointercancel, so a later pointer still scrubs', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		// A system gesture takes the first finger away without ever sending an up.
		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'touch' });
		pointerAt('pointercancel', rect.left + rect.width - 1, { pointerType: 'touch' });

		// A fresh pointer is honoured, which it would not be if the cancelled one
		// were still the active pointer: `handlePointerMove` ignores every other id.
		pointerAt('pointerdown', rect.left + 1, { pointerType: 'touch', pointerId: 2 });
		pointerAt('pointermove', rect.left + 1, { pointerType: 'touch', pointerId: 2 });

		await expect.element(chartLabel('Jun 1 \u00b7 80.0 kg')).toBeInTheDocument();
	});

	it('clears a mouse reading on pointercancel', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		const rect = svgRect();

		pointerAt('pointerdown', rect.left + rect.width - 1, { pointerType: 'mouse' });
		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).toBeInTheDocument();

		pointerAt('pointercancel', rect.left + rect.width - 1, { pointerType: 'mouse' });

		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).not.toBeInTheDocument();
	});

	/**
	 * The chart is `w-full h-full` inside its card, so its box is whatever the
	 * card is — and `preserveAspectRatio` scales the 320:140 viewBox to fit a box
	 * of a different shape, centring it in what is left over. On a box wider than
	 * that ratio the drawing sits between two empty side bars, and mapping the
	 * pointer by the box's own width instead of the SVG's matrix would select an
	 * older reading than the one being pointed at.
	 */
	it('selects by where the drawing actually is on a card wider than the viewBox', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78]) } });
		// Sized on the element itself: the component asks for `w-full h-full` and
		// takes the card's box, but Tailwind's stylesheet is not loaded in this
		// browser test, so without this the SVG falls back to its intrinsic 320:140
		// and its box always matches the viewBox exactly.
		const svg = document.querySelector('svg');
		if (!svg) throw new Error('no chart rendered');
		svg.style.width = '600px';
		svg.style.height = '100px';

		const rect = svgRect();
		expect(rect.width).toBeCloseTo(600, 0);
		expect(rect.height).toBeCloseTo(100, 0);

		// 100 / 140 is the tighter scale, so the drawing is 320 * (100 / 140) wide
		// and centred: everything left of `gutter` and right of `gutter + drawn`
		// is empty page, not chart.
		const drawn = 320 * (100 / 140);
		const gutter = (rect.width - drawn) / 2;
		pointerAt('pointerdown', rect.left + gutter + drawn - 1, { pointerType: 'mouse' });

		await expect.element(chartLabel('Jun 3 \u00b7 78.0 kg')).toBeInTheDocument();
	});

	it('selects the leftmost point when the pointer starts there, exercising every candidate in the nearest-point scan', async () => {
		await render(WeightChart, { props: { weights: readings([80, 79, 78, 77]) } });
		const rect = svgRect();

		pointerAt('pointerdown', rect.left + 1, { pointerType: 'mouse' });

		await expect.element(chartLabel('Jun 1 · 80.0 kg')).toBeInTheDocument();
	});
});
