import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { WorkoutSet } from '$lib/domain/types';
import SetRow from './SetRow.svelte';

type Bump = [field: 'reps' | 'load', direction: number];

function setup(set: WorkoutSet) {
	const bumps: Bump[] = [];
	const toggles: number[] = [];
	return {
		bumps,
		toggles,
		props: {
			number: 1,
			set,
			unit: 'kg' as const,
			onstep: (field: 'reps' | 'load', direction: number) => bumps.push([field, direction]),
			ontoggle: () => toggles.push(1)
		}
	};
}

const OPEN: WorkoutSet = { reps: 10, load: 60, done: false };

describe('SetRow', () => {
	it('shows the set number and what it is being done at', async () => {
		const { props } = setup(OPEN);
		await render(SetRow, { props });
		await expect.element(page.getByText('10')).toBeInTheDocument();
		await expect.element(page.getByText('60')).toBeInTheDocument();
	});

	it('reads a bodyweight load as a dash rather than a zero', async () => {
		const { props } = setup({ reps: 12, load: 0, done: false });
		await render(SetRow, { props });
		await expect.element(page.getByText('—')).toBeInTheDocument();
	});

	it('reports which way each stepper was pushed', async () => {
		const { props, bumps } = setup(OPEN);
		await render(SetRow, { props });
		await page.getByRole('button', { name: 'Increase reps on set 1' }).click();
		await page.getByRole('button', { name: 'Decrease load on set 1' }).click();
		expect(bumps).toEqual([
			['reps', 1],
			['load', -1]
		]);
	});

	it('reports the tick', async () => {
		const { props, toggles } = setup(OPEN);
		await render(SetRow, { props });
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		expect(toggles).toHaveLength(1);
	});

	it('leaves an untouched set unpressed', async () => {
		const { props } = setup(OPEN);
		await render(SetRow, { props });
		await expect
			.element(page.getByRole('button', { name: 'Set 1 done' }))
			.toHaveAttribute('aria-pressed', 'false');
	});

	it('settles a done set', async () => {
		const { props } = setup({ ...OPEN, done: true });
		await render(SetRow, { props });
		await expect
			.element(page.getByRole('button', { name: 'Set 1 done' }))
			.toHaveAttribute('aria-pressed', 'true');
		expect(document.querySelectorAll('.bg-primary').length).toBeGreaterThan(0);
	});
});
