import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Routine, Workout } from '$lib/domain/types';
import { tend } from '$lib/state/tend.svelte';
import ExercisePage from './+page.svelte';

/**
 * The one rule here: which of the two openings shows — the never-used shelf or
 * the deleted-rotation empty card. Each half is tested where it lives.
 *
 * Named `page.svelte.spec.ts`, not `+page.svelte.spec.ts`: SvelteKit reserves
 * the `+` prefix, so a `+`-prefixed spec in a route dir is rejected by the
 * route manifest and silently breaks the harness's input plumbing.
 */

function pushA(): Routine {
	return {
		id: 'r-1',
		name: 'Push A',
		exercises: [{ name: 'Bench Press', group: 'Chest', sets: 3, reps: 10, load: 60 }],
		deletedAt: null
	};
}

/** A session already behind the screen, so the app is not on its first run. */
function filed(): Workout {
	return {
		id: 'w-old',
		routineId: 'r-1',
		routineName: 'Push A',
		date: '2026-01-05',
		startedAt: 0,
		finishedAt: 1,
		exerciseIndex: 0,
		exercises: [
			{ name: 'Bench Press', group: 'Chest', note: '', sets: [{ reps: 10, load: 60, done: true }] }
		]
	};
}

/** The shelf's own heading, which is the whole screen when it is showing. */
function shelf() {
	return page.getByRole('heading', { name: 'Nothing here yet', level: 1 });
}

/** The home screen's heading, which the shelf replaces rather than sits under. */
function home() {
	return page.getByRole('heading', { name: 'Exercise', level: 1 });
}

/** The today-card's way of saying the rotation is empty, on the home screen. */
function emptyCard() {
	return page.getByRole('heading', { name: 'No routines yet', level: 2 });
}

beforeEach(() => {
	localStorage.clear();
	tend.resetAll();
});

describe('the exercise screen', () => {
	it('opens on the shelf when there are no routines and nothing was ever trained', async () => {
		await render(ExercisePage);
		await expect.element(shelf()).toBeInTheDocument();
		expect(home().elements()).toHaveLength(0);
	});

	// The discriminating case: routines are empty too, so a rule keyed only on
	// `routines.length === 0` would show the shelf and bury the history.
	it('keeps the home screen when the routines are gone but the history is not', async () => {
		tend.state.workouts = [filed()];
		await render(ExercisePage);
		await expect.element(home()).toBeInTheDocument();
		await expect.element(emptyCard()).toBeInTheDocument();
		// Read once rather than retried: the claim is that the shelf never
		// arrives, and a retried assertion would only prove it was not there yet.
		expect(shelf().elements()).toHaveLength(0);
	});

	it('shows the home screen once there is a routine to show', async () => {
		tend.state.routines = [pushA()];
		await render(ExercisePage);
		await expect.element(home()).toBeInTheDocument();
		expect(shelf().elements()).toHaveLength(0);
		expect(emptyCard().elements()).toHaveLength(0);
	});

	it('goes to the shelf when the empty card asks for it', async () => {
		tend.state.workouts = [filed()];
		await render(ExercisePage);
		await expect.element(emptyCard()).toBeInTheDocument();
		await page.getByRole('button', { name: 'Pick a starter' }).click();
		await expect.element(shelf()).toBeInTheDocument();
	});

	it('comes back to the home screen with the routines the template left', async () => {
		tend.state.workouts = [filed()];
		await render(ExercisePage);
		await page.getByRole('button', { name: 'Pick a starter' }).click();
		await page.getByRole('button', { name: /Full body/ }).click();
		await expect.element(home()).toBeInTheDocument();
		expect(shelf().elements()).toHaveLength(0);
		expect(tend.state.routines.length).toBeGreaterThan(0);
	});

	it('leaves the shelf for good once a template has been taken on a first run', async () => {
		await render(ExercisePage);
		await expect.element(shelf()).toBeInTheDocument();
		await page.getByRole('button', { name: /Full body/ }).click();
		await expect.element(home()).toBeInTheDocument();
		expect(shelf().elements()).toHaveLength(0);
	});
});
