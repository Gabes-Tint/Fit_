import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Routine } from '$lib/domain/types';
import { tend } from '$lib/state/tend.svelte';
import RoutineSheet from './RoutineSheet.svelte';

/** Chest is split by a Back movement, so grouping cannot preserve the order. */
const ROUTINE: Routine = {
	id: 'r-1',
	name: 'Push',
	exercises: [
		{ name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 60 },
		{ name: 'Lat Pulldown', group: 'Back', sets: 3, reps: 10, load: 45 },
		{ name: 'Incline Bench Press', group: 'Chest', sets: 3, reps: 10, load: 40 }
	],
	deletedAt: null
};

async function renderSheet(routine: Routine = ROUTINE) {
	const onload = vi.fn();
	await render(RoutineSheet, { props: { routine, onload } });
	return onload;
}

afterEach(() => tend.setLoadUnit('kg'));

describe('RoutineSheet', () => {
	it('gathers the movements under the muscle they train', async () => {
		await renderSheet();
		await expect.element(page.getByText('Chest')).toBeInTheDocument();
		await expect.element(page.getByText('Back')).toBeInTheDocument();
		expect(document.querySelectorAll('section')).toHaveLength(2);
	});

	it('heads each group with the columns of the sheet', async () => {
		await renderSheet();
		await expect.element(page.getByText('Exercise').first()).toBeInTheDocument();
		await expect.element(page.getByText('Load (kg)').first()).toBeInTheDocument();
		expect(document.querySelectorAll('section')[0]?.textContent).toContain('Reps');
	});

	it('heads the load column in the unit the loads are actually read in', async () => {
		await renderSheet();
		await expect.element(page.getByText('Load (kg)').first()).toBeInTheDocument();
		tend.setLoadUnit('lb');
		await expect.element(page.getByText('Load (lb)').first()).toBeInTheDocument();
	});

	it('reports the position in the routine, not the position on the sheet', async () => {
		const onload = await renderSheet();
		await page.getByText('Incline Bench Press').click();
		await page.getByRole('button', { name: 'Increase load' }).click();
		expect(onload).toHaveBeenCalledWith(2, 1);
	});

	it('keeps only one load editor open', async () => {
		await renderSheet();
		await page.getByText('Bench Press').first().click();
		await expect.element(page.getByRole('button', { name: 'Done' })).toBeInTheDocument();
		await page.getByText('Lat Pulldown').click();
		expect(document.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1);
	});

	it('closes the editor when the open row is tapped again', async () => {
		await renderSheet();
		await page.getByText('Lat Pulldown').click();
		await page.getByRole('button', { name: 'Done' }).click();
		expect(document.body.textContent).not.toContain('Done');
	});

	it('opens the form check for the movement whose play control was used', async () => {
		await renderSheet();
		await page.getByRole('button', { name: 'Watch Lat Pulldown' }).click();
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		expect(page.getByRole('dialog').element().textContent).toContain('Lead with the elbows');
	});

	it('says the sheet is empty rather than showing bare headings', async () => {
		await renderSheet({ ...ROUTINE, exercises: [] });
		await expect.element(page.getByText(/No movements on this sheet yet/)).toBeInTheDocument();
	});
});
