import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Routine, Workout } from '$lib/domain/types';
import { todayISO } from '$lib/domain/utils';
import { workoutFromRoutine } from '$lib/domain/workout';
import { tend } from '$lib/state/tend.svelte';
import SessionExercise from './SessionExercise.svelte';

function pushA(): Routine {
	return {
		id: 'r-1',
		name: 'Push A',
		exercises: [
			{ name: 'Bench Press', group: 'Chest', sets: 2, reps: 10, load: 60 },
			{ name: 'Lateral Raise', group: 'Shoulders', sets: 1, reps: 12, load: 8 }
		],
		deletedAt: null
	};
}

function startSession() {
	const routine = pushA();
	tend.state.routines = [routine];
	tend.state.activeWorkout = workoutFromRoutine(routine, {
		id: 'w-now',
		date: todayISO(),
		startedAt: Date.now() - 60_000
	});
	tend.persist();
}

/** Files an earlier session so "last time" has data to read. */
function fileEarlier(reps: number, load: number, name = 'Bench Press') {
	const earlier: Workout = {
		...workoutFromRoutine(pushA(), { id: 'w-old', date: todayISO(), startedAt: 0 }),
		finishedAt: 1,
		exercises: [{ name, group: 'Chest', note: '', sets: [{ reps, load, done: true }] }]
	};
	tend.state.workouts.push(earlier);
	tend.persist();
}

const logged: number[] = [];

beforeEach(() => {
	localStorage.clear();
	tend.resetAll();
	logged.length = 0;
	startSession();
});

function renderPanel() {
	return render(SessionExercise, { props: { onlog: () => logged.push(1) } });
}

describe('SessionExercise', () => {
	it('heads the load column with whatever unit is set', async () => {
		tend.setLoadUnit('lb');
		await renderPanel();
		await expect.element(page.getByText('Load (lb)')).toBeInTheDocument();
	});

	it('reads what the movement went at last time in that unit too', async () => {
		tend.setLoadUnit('lb');
		fileEarlier(8, 55);
		await renderPanel();
		await expect.element(page.getByText('8 × 55 lb')).toBeInTheDocument();
	});

	it('names the movement and where it sits in the session', async () => {
		await renderPanel();
		await expect.element(page.getByText('Exercise 1 of 2')).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: 'Bench Press' })).toBeInTheDocument();
		await expect.element(page.getByText('Chest')).toBeInTheDocument();
	});

	it('leaves out "last time" when the movement has no history', async () => {
		await renderPanel();
		await expect.element(page.getByText('Add set')).toBeInTheDocument();
		expect(page.getByText('Last time').elements()).toHaveLength(0);
	});

	it('reads back what the movement went at last time', async () => {
		fileEarlier(8, 55);
		await renderPanel();
		await expect.element(page.getByText('Last time')).toBeInTheDocument();
		await expect.element(page.getByText('8 × 55 kg')).toBeInTheDocument();
	});

	it('ticks a set into the session and reports the start of the rest', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		expect(tend.currentExercise?.sets[0]?.done).toBe(true);
		expect(logged).toHaveLength(1);
	});

	it('does not start a rest when a tick is taken back', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		expect(tend.currentExercise?.sets[0]?.done).toBe(false);
		expect(logged).toHaveLength(1);
	});

	it('adjusts a set through the steppers', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Increase reps on set 1' }).click();
		await page.getByRole('button', { name: 'Decrease load on set 2' }).click();
		expect(tend.currentExercise?.sets[0]?.reps).toBe(11);
		expect(tend.currentExercise?.sets[1]?.load).toBe(57.5);
	});

	it('adds a set beyond what the routine asked for', async () => {
		await renderPanel();
		await page.getByText('Add set').click();
		expect(tend.currentExercise?.sets).toHaveLength(3);
	});

	it('keeps the note with the exercise', async () => {
		await renderPanel();
		await page.getByLabelText('Notes').fill('Left shoulder pinching — dropped the load.');
		expect(tend.currentExercise?.note).toBe('Left shoulder pinching — dropped the load.');
	});

	it('swaps the movement without losing the session', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Swap' }).click();
		await page.getByText('Pec Deck').click();
		expect(tend.currentExercise?.name).toBe('Pec Deck');
		expect(tend.currentExercise?.sets).toHaveLength(2);
	});

	it('reads a bodyweight movement back without a load', async () => {
		fileEarlier(12, 0);
		await renderPanel();
		await expect.element(page.getByText('12 × —')).toBeInTheDocument();
	});

	it('opens the form check on the movement, and closes it again', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Watch the movement' }).click();
		await expect.element(page.getByText('Form check')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Got it' }).click();
		expect(page.getByText('Form check').elements()).toHaveLength(0);
	});

	it('closes the swap sheet without changing anything', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Swap' }).click();
		await page.getByRole('button', { name: 'Close' }).click();
		expect(page.getByText('Pec Deck').elements()).toHaveLength(0);
		expect(tend.currentExercise?.name).toBe('Bench Press');
	});

	it('ticks a set for a caller that does not want to hear about it', async () => {
		await render(SessionExercise, { props: {} });
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		expect(tend.currentExercise?.sets[0]?.done).toBe(true);
	});

	it('follows the session on to the next exercise', async () => {
		await renderPanel();
		tend.nextExercise();
		await expect.element(page.getByText('Exercise 2 of 2')).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: 'Lateral Raise' })).toBeInTheDocument();
	});

	it('reads back the history of the movement it was swapped for', async () => {
		fileEarlier(8, 55);
		fileEarlier(9, 40, 'Pec Deck');
		await renderPanel();
		await expect.element(page.getByText('8 × 55 kg')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Swap' }).click();
		await page.getByText('Pec Deck').click();
		await expect.element(page.getByText('9 × 40 kg')).toBeInTheDocument();
	});

	it('renders nothing when no session is running', async () => {
		tend.state.activeWorkout = null;
		tend.persist();
		await renderPanel();
		expect(page.getByText('Add set').elements()).toHaveLength(0);
	});
});
