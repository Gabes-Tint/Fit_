import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { RoutineExercise, Workout } from '$lib/domain/types';
import { addDaysISO, todayISO } from '$lib/domain/utils';
import { workoutFromRoutine } from '$lib/domain/workout';
import VolumeByGroup from './VolumeByGroup.svelte';

const press: RoutineExercise = { name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 40 };
const squat: RoutineExercise = { name: 'Squat', group: 'Legs', sets: 2, reps: 5, load: 70 };

function session(date: string, finished: boolean): Workout {
	const workout = workoutFromRoutine(
		{ id: 'r1', name: 'Full body', exercises: [press, squat], deletedAt: null },
		{ id: `w${date}`, date, startedAt: 0 }
	);
	for (const exercise of workout.exercises) {
		for (const set of exercise.sets) set.done = true;
	}
	return { ...workout, finishedAt: finished ? 1 : null };
}

describe('VolumeByGroup', () => {
	it('lists each group with the sets it took', async () => {
		await render(VolumeByGroup, { props: { workouts: [session(todayISO(), true)] } });
		await expect.element(page.getByText('Chest')).toBeInTheDocument();
		await expect.element(page.getByText('4 sets')).toBeInTheDocument();
		await expect.element(page.getByText('2 sets')).toBeInTheDocument();
	});

	it('draws the busiest group full and the rest against it', async () => {
		await render(VolumeByGroup, { props: { workouts: [session(todayISO(), true)] } });
		const bars = [...document.querySelectorAll('.bg-primary')].map((b) => b.getAttribute('style'));
		expect(bars).toEqual(['width: 100%;', 'width: 50%;']);
	});

	it('leaves out sessions older than four weeks', async () => {
		const old = addDaysISO(todayISO(), -30);
		await render(VolumeByGroup, { props: { workouts: [session(old, true)] } });
		await expect.element(page.getByText(/no volume to compare/)).toBeInTheDocument();
	});

	it('counts only what was finished', async () => {
		await render(VolumeByGroup, { props: { workouts: [session(todayISO(), false)] } });
		await expect.element(page.getByText(/no volume to compare/)).toBeInTheDocument();
	});
});
