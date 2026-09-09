import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import GlpRingCluster from './GlpRingCluster.svelte';

const PROPS = {
	energyValue: 0,
	energyTarget: 2182,
	proteinValue: 0,
	proteinTarget: 189,
	fiberValue: 0,
	fiberTarget: 28
};

function ringRadii() {
	return Array.from(document.querySelectorAll('circle')).map((c) => Number(c.getAttribute('r')));
}

describe('GlpRingCluster', () => {
	it('renders three nested rings, Energy outside, Protein middle, Fiber inside', async () => {
		await render(GlpRingCluster, { props: PROPS });
		const radii = ringRadii();
		// Two circles (track + progress) per ring, so six in total.
		expect(radii).toHaveLength(6);
		const [energyTrack, energyArc, proteinTrack, proteinArc, fiberTrack, fiberArc] = radii;
		expect(energyTrack).toBe(energyArc);
		expect(proteinTrack).toBe(proteinArc);
		expect(fiberTrack).toBe(fiberArc);
		// Each ring's radius steps in by exactly one stroke width plus the gap
		// (10 + 4 = 14), so there is a visible gap between rings, not just a
		// smaller radius.
		expect((energyTrack ?? 0) - (proteinTrack ?? 0)).toBe(14);
		expect((proteinTrack ?? 0) - (fiberTrack ?? 0)).toBe(14);
	});

	it('is empty at the centre by default', async () => {
		await render(GlpRingCluster, { props: PROPS });
		expect(document.querySelector('button')?.textContent?.trim()).toBe('');
	});

	it('exposes all three names and targets in one aria-label', async () => {
		await render(GlpRingCluster, {
			props: { ...PROPS, energyValue: 5, proteinValue: 10, fiberValue: 2 }
		});
		const label = document.querySelector('button')?.getAttribute('aria-label') ?? '';
		expect(label).toContain('Energy 5 of 2182 kcal');
		expect(label).toContain('Protein 10 of 189 g');
		expect(label).toContain('Fiber 2 of 28 g');
	});

	it('cycles Energy, Protein, Fiber, then empty again on repeated taps', async () => {
		await render(GlpRingCluster, {
			props: { ...PROPS, energyValue: 1200, proteinValue: 80, fiberValue: 14 }
		});
		const cluster = page.getByRole('button');

		await cluster.click();
		await expect.element(page.getByText('Energy')).toBeInTheDocument();
		await expect.element(page.getByText('of 2182 kcal')).toBeInTheDocument();

		await cluster.click();
		await expect.element(page.getByText('Protein')).toBeInTheDocument();
		await expect.element(page.getByText('of 189 g')).toBeInTheDocument();

		await cluster.click();
		await expect.element(page.getByText('Fiber')).toBeInTheDocument();
		await expect.element(page.getByText('of 28 g')).toBeInTheDocument();

		await cluster.click();
		expect(document.querySelector('button')?.textContent?.trim()).toBe('');
	});

	it('cycles backwards on ArrowLeft after ArrowRight moved forward', async () => {
		await render(GlpRingCluster, { props: PROPS });
		const cluster = page.getByRole('button');
		cluster.element().focus();

		cluster
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await expect.element(page.getByText('Energy')).toBeInTheDocument();

		cluster
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await expect.element(page.getByText('Protein')).toBeInTheDocument();

		cluster
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		await expect.element(page.getByText('Energy')).toBeInTheDocument();
	});

	it('reveals the hovered ring even while no ring is tapped, for a mouse pointer', async () => {
		await render(GlpRingCluster, {
			props: { ...PROPS, proteinValue: 80 }
		});
		const proteinGroup = document.querySelectorAll('g')[1];
		proteinGroup?.dispatchEvent(
			new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' })
		);
		await expect.element(page.getByText('Protein')).toBeInTheDocument();
		await expect.element(page.getByText('of 189 g')).toBeInTheDocument();

		proteinGroup?.dispatchEvent(
			new PointerEvent('pointerleave', { bubbles: true, pointerType: 'mouse' })
		);
		await expect.element(page.getByText('Protein')).not.toBeInTheDocument();
	});

	it('does not pin the reveal on a touch pointer, so tapping still cycles to Protein and Fiber', async () => {
		await render(GlpRingCluster, {
			props: { ...PROPS, energyValue: 1200, proteinValue: 80, fiberValue: 14 }
		});
		const cluster = page.getByRole('button');
		const energyGroup = document.querySelectorAll('g')[0];

		// A touch tap fires a compatibility pointerenter (no matching
		// pointerleave) on whatever ring is under the finger — here, the
		// outer Energy ring — before the click that should advance the cycle.
		energyGroup?.dispatchEvent(
			new PointerEvent('pointerenter', { bubbles: true, pointerType: 'touch' })
		);

		await cluster.click();
		await expect.element(page.getByText('Energy')).toBeInTheDocument();

		await cluster.click();
		await expect.element(page.getByText('Protein')).toBeInTheDocument();

		await cluster.click();
		await expect.element(page.getByText('Fiber')).toBeInTheDocument();
	});
});
