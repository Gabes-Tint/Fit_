import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Routine } from '$lib/domain/types';
import RoutineRow from './RoutineRow.svelte';

const routine: Routine = {
	id: 'push',
	name: 'Chest & Shoulders',
	exercises: [
		{ name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 45 },
		{ name: 'Lateral Raise', group: 'Shoulders', sets: 3, reps: 15, load: 8 }
	]
};

const legs: Routine = {
	id: 'legs',
	name: 'Legs',
	exercises: [
		{ name: 'Squat', group: 'Legs', sets: 5, reps: 5, load: 70 },
		{ name: 'Leg Press', group: 'Legs', sets: 4, reps: 10, load: 120 },
		{ name: 'Calf Raise', group: 'Legs', sets: 4, reps: 20, load: 60 }
	]
};

const noop = () => {};

describe('RoutineRow', () => {
	it('names the routine', async () => {
		await render(RoutineRow, { props: { routine, index: 0, onstart: noop } });
		await expect.element(page.getByText('Chest & Shoulders')).toBeInTheDocument();
	});

	it('sums what the routine costs', async () => {
		await render(RoutineRow, { props: { routine, index: 0, onstart: noop } });
		await expect.element(page.getByText('2 exercises · 7 sets')).toBeInTheDocument();
	});

	it('numbers the routine by its place in the rotation', async () => {
		await render(RoutineRow, { props: { routine, index: 2, onstart: noop } });
		await expect.element(page.getByText('3', { exact: true })).toBeInTheDocument();
	});

	it('marks the row when the day’s plan holds the routine', async () => {
		await render(RoutineRow, { props: { routine, index: 1, current: true, onstart: noop } });
		expect(document.querySelectorAll('[class*="bg-primary"]')).toHaveLength(1);
	});

	it('opens the routine', async () => {
		await render(RoutineRow, { props: { routine, index: 0, onstart: noop } });
		await expect
			.element(page.getByRole('link', { name: /Chest & Shoulders/ }))
			.toHaveAttribute('href', '/exercise/routines/push');
	});

	it('starts the routine from the button beside it', async () => {
		const onstart = vi.fn();
		await render(RoutineRow, { props: { routine, index: 0, onstart } });
		await page.getByRole('button', { name: 'Start Chest & Shoulders' }).click();
		expect(onstart).toHaveBeenCalledWith('push');
	});

	it('will not start a routine with nothing on it', async () => {
		const bare: Routine = { id: 'bare', name: 'Blank', exercises: [] };
		await render(RoutineRow, { props: { routine: bare, index: 0, onstart: noop } });
		await expect.element(page.getByRole('button', { name: 'Start Blank' })).toBeDisabled();
	});

	it('tones the badge by position, so two routines never look alike', async () => {
		await render(RoutineRow, { props: { routine, index: 1, onstart: noop } });
		expect(document.querySelectorAll('[class*="bg-sage-soft"]')).toHaveLength(1);
		expect(document.querySelectorAll('[class*="bg-primary"]')).toHaveLength(0);
	});

	it('follows a routine that changed under it', async () => {
		const props = $state({ routine, index: 0, onstart: noop });
		await render(RoutineRow, { props });
		props.routine = legs;
		props.index = 1;
		await expect.element(page.getByText('Legs')).toBeInTheDocument();
		await expect.element(page.getByText('3 exercises · 13 sets')).toBeInTheDocument();
		await expect.element(page.getByText('2', { exact: true })).toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: /Legs/ }))
			.toHaveAttribute('href', '/exercise/routines/legs');
	});
});
