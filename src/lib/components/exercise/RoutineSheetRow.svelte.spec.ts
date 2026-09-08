import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { LoadUnit, RoutineExercise } from '$lib/domain/types';
import RoutineSheetRow from './RoutineSheetRow.svelte';

const BENCH: RoutineExercise = { name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 60 };

async function renderRow(exercise: RoutineExercise = BENCH, open = false, unit: LoadUnit = 'kg') {
	const handlers = { ontoggle: vi.fn(), onplay: vi.fn(), onload: vi.fn() };
	await render(RoutineSheetRow, { props: { exercise, unit, open, ...handlers } });
	return handlers;
}

describe('RoutineSheetRow', () => {
	it('reads the movement and what it prescribes', async () => {
		await renderRow();
		await expect.element(page.getByText('Bench Press')).toBeInTheDocument();
		await expect.element(page.getByText('4')).toBeInTheDocument();
		await expect.element(page.getByText('8')).toBeInTheDocument();
		await expect.element(page.getByText('60')).toBeInTheDocument();
	});

	it('shows a bodyweight movement as an em dash rather than a zero load', async () => {
		await renderRow({ name: 'Pull-up', group: 'Back', sets: 3, reps: 6, load: 0 });
		await expect.element(page.getByText('—')).toBeInTheDocument();
	});

	it('asks to be opened when the row is tapped', async () => {
		const { ontoggle } = await renderRow();
		await page.getByText('Bench Press').click();
		expect(ontoggle).toHaveBeenCalledTimes(1);
	});

	it('offers a form check for the movement', async () => {
		const { onplay } = await renderRow();
		await page.getByRole('button', { name: 'Watch Bench Press' }).click();
		expect(onplay).toHaveBeenCalledTimes(1);
	});

	it('keeps the load editor out of the way until the row is open', async () => {
		await renderRow();
		expect(document.body.textContent).not.toContain('Done');
	});

	it('steps the load up and down while open', async () => {
		const { onload } = await renderRow(BENCH, true);
		await page.getByRole('button', { name: 'Increase load' }).click();
		await page.getByRole('button', { name: 'Decrease load' }).click();
		expect(onload.mock.calls).toEqual([[1], [-1]]);
	});

	it('collapses again from the editor', async () => {
		const { ontoggle } = await renderRow(BENCH, true);
		await page.getByRole('button', { name: 'Done' }).click();
		expect(ontoggle).toHaveBeenCalledTimes(1);
	});
});
