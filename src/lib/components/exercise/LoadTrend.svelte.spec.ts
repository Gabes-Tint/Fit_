import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { calendarWeeks } from '$lib/domain/training-plan';
import type { RoutineExercise, Workout } from '$lib/domain/types';
import { addDaysISO } from '$lib/domain/utils';
import { workoutFromRoutine } from '$lib/domain/workout';
import { tend } from '$lib/state/tend.svelte';
import LoadTrend from './LoadTrend.svelte';

const monday = calendarWeeks(new Date().getFullYear())[0]?.startISO ?? '';

function bench(load: number): RoutineExercise {
	return { name: 'Bench Press', group: 'Chest', sets: 2, reps: 8, load };
}

const squat: RoutineExercise = { name: 'Squat', group: 'Legs', sets: 2, reps: 5, load: 70 };

function session(weekIndex: number, exercises: RoutineExercise[]): Workout {
	const date = addDaysISO(monday, weekIndex * 7 + 1);
	const workout = workoutFromRoutine(
		{ id: 'r1', name: 'Push', exercises, deletedAt: null },
		{ id: `w${weekIndex}`, date, startedAt: 0 }
	);
	for (const exercise of workout.exercises) {
		for (const set of exercise.sets) set.done = true;
	}
	return { ...workout, finishedAt: 1 };
}

afterEach(() => tend.setLoadUnit('kg'));

describe('LoadTrend', () => {
	// Loads are stored in kilograms, so reading in pounds converts them rather
	// than relabelling them: a 45 kg top set is 99.2 lb, and calling it "45 lb"
	// would be reporting a lift that never happened.
	it('converts the chart into whatever unit is set, rather than relabelling it', async () => {
		tend.setLoadUnit('lb');
		const workouts = [session(0, [bench(40)]), session(1, [bench(42.5)]), session(2, [bench(45)])];
		await render(LoadTrend, { props: { workouts } });
		await expect
			.element(page.getByText('Bench Press · top set, last 3 weeks · +11 lb'))
			.toBeInTheDocument();
		await expect.element(page.getByText('99.2 lb')).toBeInTheDocument();
	});

	it('captions the movement, the range and the change across it', async () => {
		const workouts = [session(0, [bench(40)]), session(1, [bench(42.5)]), session(2, [bench(45)])];
		await render(LoadTrend, { props: { workouts } });
		await expect
			.element(page.getByText('Bench Press · top set, last 3 weeks · +5 kg'))
			.toBeInTheDocument();
	});

	it('labels the latest week with its top set', async () => {
		const workouts = [session(0, [bench(40)]), session(1, [bench(45)])];
		await render(LoadTrend, { props: { workouts } });
		await expect.element(page.getByText('45 kg')).toBeInTheDocument();
	});

	it('reports no change when the top set has not moved', async () => {
		const workouts = [session(0, [bench(40)]), session(1, [bench(40)])];
		await render(LoadTrend, { props: { workouts } });
		await expect.element(page.getByText(/no change$/)).toBeInTheDocument();
	});

	it('reads a lighter top set as a loss rather than a gain', async () => {
		const workouts = [session(0, [bench(45)]), session(1, [bench(40)])];
		await render(LoadTrend, { props: { workouts } });
		await expect.element(page.getByText(/-5 kg$/)).toBeInTheDocument();
	});

	it('claims no change from a single week', async () => {
		await render(LoadTrend, { props: { workouts: [session(0, [bench(40)])] } });
		await expect.element(page.getByText('Bench Press · top set, last 1 week')).toBeInTheDocument();
	});

	it('measures the caption in weeks elapsed, not in bars drawn', async () => {
		const workouts = [session(0, [bench(40)]), session(14, [bench(50)])];
		await render(LoadTrend, { props: { workouts } });
		await expect
			.element(page.getByText('Bench Press · top set, last 15 weeks · +10 kg'))
			.toBeInTheDocument();
	});

	it('says there is nothing to follow when no session was finished', async () => {
		await render(LoadTrend, { props: { workouts: [] } });
		await expect.element(page.getByText(/no load to follow/)).toBeInTheDocument();
	});

	it('charts another movement when it is picked', async () => {
		const workouts = [
			session(0, [bench(40)]),
			session(1, [bench(45)]),
			session(2, [bench(45), squat])
		];
		await render(LoadTrend, { props: { workouts } });
		await page.getByRole('button', { name: 'Squat' }).click();
		await expect.element(page.getByText(/^Squat · top set/)).toBeInTheDocument();
	});

	it('offers no picker when one movement is all that was trained', async () => {
		await render(LoadTrend, { props: { workouts: [session(0, [bench(40)])] } });
		expect(document.querySelectorAll('button')).toHaveLength(0);
	});
});
