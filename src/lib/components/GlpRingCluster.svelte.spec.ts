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
		// The first pair (Energy) has the largest radius, the last pair
		// (Fiber) the smallest — each smaller than the last by more than a
		// stroke width, so there is a visible gap between rings.
		expect(radii[0]).toBe(radii[1]);
		expect(radii[2]).toBe(radii[3]);
		expect(radii[4]).toBe(radii[5]);
		expect(radii[0]).toBeGreaterThan(radii[2]);
		expect(radii[2]).toBeGreaterThan(radii[4]);
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

	it('reveals the hovered ring even while no ring is tapped', async () => {
		await render(GlpRingCluster, {
			props: { ...PROPS, proteinValue: 80 }
		});
		const proteinGroup = document.querySelectorAll('g')[1];
		proteinGroup?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		await expect.element(page.getByText('Protein')).toBeInTheDocument();
		await expect.element(page.getByText('of 189 g')).toBeInTheDocument();

		proteinGroup?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
		await expect.element(page.getByText('Protein')).not.toBeInTheDocument();
	});
});
