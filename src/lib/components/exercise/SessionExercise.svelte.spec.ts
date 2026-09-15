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
		exercises: [{ name, group: 'Chest', sets: [{ reps, load, done: true }] }]
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

function session() {
	const workout = tend.state.activeWorkout;
	if (!workout) throw new Error('test expects a running session');
	return workout;
}

function exerciseAt(index: number) {
	const exercise = session().exercises[index];
	if (!exercise) throw new Error(`test expects an exercise at ${index}`);
	return exercise;
}

function renderPanel(index = 0) {
	return render(SessionExercise, {
		props: { exercise: exerciseAt(index), index, onlog: () => logged.push(1) }
	});
}

describe('SessionExercise', () => {
	it('heads the load column with whatever unit is set', async () => {
		tend.setLoadUnit('lb');
		await renderPanel();
		await expect.element(page.getByText('Load (lb)')).toBeInTheDocument();
	});

	it('converts what the movement went at last time into that unit too', async () => {
		tend.setLoadUnit('lb');
		fileEarlier(8, 55);
		await renderPanel();
		await expect.element(page.getByText('8 × 121.3 lb')).toBeInTheDocument();
	});

	it('names the movement as a region of its own, with no count of where it sits', async () => {
		await renderPanel();
		await expect.element(page.getByRole('region', { name: 'Bench Press' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: 'Bench Press' })).toBeInTheDocument();
		expect(page.getByText(/Exercise \d+ of \d+/).elements()).toHaveLength(0);
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
		expect(session().exercises[0]?.sets[0]?.done).toBe(true);
		expect(logged).toHaveLength(1);
	});

	it('does not start a rest when a tick is taken back', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		expect(session().exercises[0]?.sets[0]?.done).toBe(false);
		expect(logged).toHaveLength(1);
	});

	it('adjusts a set through the steppers', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Increase reps on set 1' }).click();
		await page.getByRole('button', { name: 'Decrease load on set 2' }).click();
		expect(session().exercises[0]?.sets[0]?.reps).toBe(11);
		expect(session().exercises[0]?.sets[1]?.load).toBe(57.5);
	});

	it('adds a set beyond what the routine asked for', async () => {
		await renderPanel();
		await page.getByText('Add set').click();
		expect(session().exercises[0]?.sets).toHaveLength(3);
	});

	// Supersedes 'keeps the note with the exercise': one note is written for the
	// whole session, on the page, so the block carries no field of its own (#477).
	it('offers no note of its own', async () => {
		await renderPanel();
		expect(page.getByLabelText('Notes').elements()).toHaveLength(0);
		expect(page.getByPlaceholder('How did the session go?').elements()).toHaveLength(0);
	});

	it('swaps the movement without losing the session', async () => {
		await renderPanel();
		await page.getByRole('button', { name: 'Swap' }).click();
		await page.getByText('Pec Deck').click();
		expect(session().exercises[0]?.name).toBe('Pec Deck');
		expect(session().exercises[0]?.sets).toHaveLength(2);
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
		expect(session().exercises[0]?.name).toBe('Bench Press');
	});

	it('ticks a set for a caller that does not want to hear about it', async () => {
		await render(SessionExercise, { props: { exercise: exerciseAt(0), index: 0 } });
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		expect(session().exercises[0]?.sets[0]?.done).toBe(true);
	});

	it('addresses every action to the exercise it was given, leaving the others alone', async () => {
		await renderPanel(1);
		await page.getByRole('button', { name: 'Set 1 done' }).click();
		await page.getByRole('button', { name: 'Increase reps on set 1' }).click();
		await page.getByText('Add set').click();
		const [bench, raise] = session().exercises;
		expect(raise?.sets.map((s) => s.done)).toEqual([true, false]);
		expect(raise?.sets[0]?.reps).toBe(13);
		expect(bench?.sets.some((s) => s.done)).toBe(false);
		expect(bench?.sets).toHaveLength(2);
		expect(logged).toHaveLength(1);
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
});
