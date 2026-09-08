import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { RoutineExercise, Workout } from '$lib/domain/types';
import { monthDay, todayISO } from '$lib/domain/utils';
import { workoutFromRoutine } from '$lib/domain/workout';
import { tend } from '$lib/state/tend.svelte';
import PersonalRecordList from './PersonalRecordList.svelte';

const press: RoutineExercise = { name: 'Bench Press', group: 'Chest', sets: 1, reps: 8, load: 45 };
const squat: RoutineExercise = { name: 'Squat', group: 'Legs', sets: 1, reps: 5, load: 70 };
const pushUp: RoutineExercise = { name: 'Push-up', group: 'Chest', sets: 1, reps: 12, load: 0 };

function session(exercises: RoutineExercise[], ticked: boolean): Workout {
	const workout = workoutFromRoutine(
		{ id: 'r1', name: 'Full body', exercises, deletedAt: null },
		{ id: 'w1', date: todayISO(), startedAt: 0 }
	);
	for (const exercise of workout.exercises) {
		for (const set of exercise.sets) set.done = ticked;
	}
	return { ...workout, finishedAt: 1 };
}

afterEach(() => tend.setLoadUnit('kg'));

describe('PersonalRecordList', () => {
	// A record is a mass, held in kilograms. Reading it in pounds converts it;
	// printing "70 lb" beside a 70 kg squat would rewrite somebody's best lift.
	it('converts the best set into whatever unit is set', async () => {
		tend.setLoadUnit('lb');
		await render(PersonalRecordList, { props: { workouts: [session([press, squat], true)] } });
		await expect.element(page.getByText('154.3 lb × 5')).toBeInTheDocument();
		await expect.element(page.getByText('99.2 lb × 8')).toBeInTheDocument();
	});

	it('names the best set of each movement and when it was lifted', async () => {
		await render(PersonalRecordList, { props: { workouts: [session([press, squat], true)] } });
		await expect.element(page.getByText('70 kg × 5')).toBeInTheDocument();
		await expect.element(page.getByText('45 kg × 8')).toBeInTheDocument();
		await expect.element(page.getByText(monthDay(todayISO())).first()).toBeInTheDocument();
	});

	it('puts the heaviest movement first', async () => {
		await render(PersonalRecordList, { props: { workouts: [session([press, squat], true)] } });
		const names = [...document.querySelectorAll('li')].map((row) => row.textContent?.trim());
		expect(names[0]).toContain('Squat');
	});

	it('leaves out sets that were never ticked', async () => {
		await render(PersonalRecordList, { props: { workouts: [session([press], false)] } });
		await expect.element(page.getByText(/no best set to name/)).toBeInTheDocument();
	});

	it('leaves out bodyweight sets, which carry no load to beat', async () => {
		await render(PersonalRecordList, { props: { workouts: [session([pushUp], true)] } });
		await expect.element(page.getByText(/no best set to name/)).toBeInTheDocument();
	});
});
