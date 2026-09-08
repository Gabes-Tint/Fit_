import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Routine, Workout } from '$lib/domain/types';
import { addDaysISO, todayISO } from '$lib/domain/utils';
import { workoutFromRoutine } from '$lib/domain/workout';
import { tend } from '$lib/state/tend.svelte';
import WorkoutSummary from './WorkoutSummary.svelte';

const STARTED = 1_700_000_000_000;

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

/**
 * Two weeks of pressing, a shoulder movement in the first, so the trend has a
 * movement to open on and a group with the fewest sets behind it.
 */
function fileTwoWeeksOfPressing() {
	const press = (load: number) => ({
		name: 'Bench Press',
		group: 'Chest' as const,
		note: '',
		sets: [{ reps: 8, load, done: true }]
	});
	const raise = {
		name: 'Lateral Raise',
		group: 'Shoulders' as const,
		note: '',
		sets: [{ reps: 12, load: 8, done: true }]
	};
	const base = {
		routineId: 'r-1',
		routineName: 'Push A',
		startedAt: STARTED,
		finishedAt: STARTED + 2730 * 1000,
		exerciseIndex: 0
	};
	tend.state.workouts.push(
		{ ...base, id: 'w-last', date: addDaysISO(todayISO(), -7), exercises: [press(40), raise] },
		{ ...base, id: 'w-now', date: todayISO(), exercises: [press(50)] }
	);
	tend.persist();
}

/** File a session that was walked out of with nothing ticked at all. */
function fileEmptySession() {
	const workout: Workout = workoutFromRoutine(pushA(), {
		id: 'w-empty',
		date: todayISO(),
		startedAt: STARTED
	});
	workout.finishedAt = STARTED + 600 * 1000;
	tend.state.workouts.push(workout);
	tend.persist();
}

/** File a session that ran 45:30 and had every set but the last one ticked. */
function fileSession() {
	const workout: Workout = workoutFromRoutine(pushA(), {
		id: 'w-1',
		date: todayISO(),
		startedAt: STARTED
	});
	workout.finishedAt = STARTED + 2730 * 1000;
	workout.exercises[0]?.sets.forEach((set) => (set.done = true));
	tend.state.workouts.push(workout);
	tend.persist();
}

beforeEach(() => {
	localStorage.clear();
	tend.resetAll();
});

describe('WorkoutSummary', () => {
	it('closes the session by name', async () => {
		fileSession();
		await render(WorkoutSummary);
		await expect.element(page.getByText('Session done')).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: 'Push A' })).toBeInTheDocument();
		await expect
			.element(page.getByText('Logged and filed. Nothing else to do.'))
			.toBeInTheDocument();
	});

	it('counts the session in time, sets and kilograms', async () => {
		fileSession();
		await render(WorkoutSummary);
		await expect.element(page.getByText('0:45:30')).toBeInTheDocument();
		await expect.element(page.getByText('2', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('1200 kg')).toBeInTheDocument();
	});

	it('reads back each movement and what it went at', async () => {
		fileSession();
		await render(WorkoutSummary);
		await expect.element(page.getByText('2 × 10 @ 60')).toBeInTheDocument();
	});

	it('says an untouched movement was not done, rather than counting it as zero', async () => {
		fileSession();
		await render(WorkoutSummary);
		await expect.element(page.getByText('not done')).toBeInTheDocument();
	});

	it('offers the way on and the way out', async () => {
		fileSession();
		await render(WorkoutSummary);
		await expect
			.element(page.getByRole('link', { name: 'See training progress' }))
			.toHaveAttribute('href', '/exercise/progress');
		await expect
			.element(page.getByRole('link', { name: 'Done' }))
			.toHaveAttribute('href', '/exercise');
	});

	it('reads an exercise with no sets at all back the same way', async () => {
		fileSession();
		const filed = tend.state.workouts.at(-1);
		// Beside the movement that did happen: the read-back only appears at all
		// once something was ticked.
		filed?.exercises.push({ name: 'Pull-up', group: 'Back', note: '', sets: [] });
		await render(WorkoutSummary);
		await expect.element(page.getByText('Pull-up')).toBeInTheDocument();
		// Its own row, beside the movement that was reached but not ticked.
		expect(page.getByText('not done').elements()).toHaveLength(2);
	});

	// A swap can leave two rows with the same name; reading back must not depend
	// on the names differing.
	it('reads back a session where two movements share a name', async () => {
		fileSession();
		const second = tend.state.workouts.at(-1)?.exercises[1];
		if (second) second.name = 'Bench Press';
		await render(WorkoutSummary);
		await expect.element(page.getByRole('heading', { name: 'Push A' })).toBeInTheDocument();
		expect(page.getByText('Bench Press', { exact: true }).elements()).toHaveLength(2);
	});

	// The volume is a mass moved, so it converts with the loads that make it up.
	it('converts the volume into whatever unit is set', async () => {
		tend.setLoadUnit('lb');
		fileSession();
		await render(WorkoutSummary);
		await expect.element(page.getByText('2646 lb')).toBeInTheDocument();
	});

	// A walked-out session is still filed, and the screen says so.
	it('files a session where nothing was ticked and says as much', async () => {
		fileEmptySession();
		await render(WorkoutSummary);
		await expect.element(page.getByRole('heading', { name: 'Push A' })).toBeInTheDocument();
		await expect
			.element(page.getByText('Nothing logged this time. Showing up counts; the numbers can wait.'))
			.toBeInTheDocument();
	});

	// The kind sentence and a page of zeroes under it would contradict each
	// other, and the zeroes are the half that is not worth saying.
	it('reads nothing back after a session that logged nothing', async () => {
		fileEmptySession();
		await render(WorkoutSummary);
		expect(page.getByText('0 kg').elements()).toHaveLength(0);
		expect(page.getByText('Sets done').elements()).toHaveLength(0);
		expect(page.getByText('What you did').elements()).toHaveLength(0);
		expect(page.getByText('not done').elements()).toHaveLength(0);
	});

	// Nothing was logged, so there is nothing to go and look at; the way out is
	// the only thing left to offer.
	it('offers only the way out after a session that logged nothing', async () => {
		fileEmptySession();
		await render(WorkoutSummary);
		await expect.element(page.getByRole('link', { name: 'Done' })).toBeInTheDocument();
		expect(page.getByRole('link', { name: 'See training progress' }).elements()).toHaveLength(0);
	});

	// Weeks of training sit behind this one, so the note has plenty to say — it
	// just must not say it over a session that contributed nothing to it.
	it('has no take-away to offer after a session that logged nothing', async () => {
		fileTwoWeeksOfPressing();
		fileEmptySession();
		await render(WorkoutSummary);
		expect(page.getByText(/thin part of the plan/).elements()).toHaveLength(0);
	});

	it('closes with what the training has been doing lately', async () => {
		fileTwoWeeksOfPressing();
		await render(WorkoutSummary);
		await expect
			.element(
				page.getByText(
					'Bench Press is 10 kg heavier than 1 week ago. Shoulders are still the thin part of the plan.'
				)
			)
			.toBeInTheDocument();
	});

	it('converts the take-away into whatever unit is set', async () => {
		tend.setLoadUnit('lb');
		fileTwoWeeksOfPressing();
		await render(WorkoutSummary);
		await expect
			.element(page.getByText(/Bench Press is 22 lb heavier than 1 week ago\./))
			.toBeInTheDocument();
	});

	it('says so when nothing has been filed yet', async () => {
		await render(WorkoutSummary);
		await expect.element(page.getByText('Nothing filed yet')).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Back to Exercise' })).toBeInTheDocument();
	});
});
