import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Workout } from '$lib/domain/types';
import { tend } from '$lib/state/tend.svelte';
import ProgressPage from './+page.svelte';

/**
 * The one rule here: whether there is anything to chart. A session filed with
 * nothing ticked must not clear the empty state into four blank charts. Named
 * `page.svelte.spec.ts`, not `+page.svelte.spec.ts`, because SvelteKit reserves
 * the `+` prefix in a route directory.
 */

function filed(done: boolean): Workout {
	return {
		id: 'w-old',
		routineId: 'r-1',
		routineName: 'Push A',
		date: '2026-01-05',
		startedAt: 0,
		finishedAt: 1,
		exerciseIndex: 0,
		note: '',
		exercises: [{ name: 'Bench Press', group: 'Chest', sets: [{ reps: 10, load: 60, done }] }]
	};
}

/** The card that stands in for the charts when there is nothing to draw. */
function nothingYet() {
	return page.getByText(/nothing here to chart/);
}

/**
 * One of the four charts, standing for all: its heading renders even with no
 * data, so its absence means the charts were not reached, not that it was empty.
 */
function charts() {
	return page.getByRole('heading', { name: 'Volume by muscle group', level: 2 });
}

beforeEach(() => {
	localStorage.clear();
	tend.resetAll();
});

describe('the training progress screen', () => {
	it('says there is nothing to chart before anything has been trained', async () => {
		await render(ProgressPage);
		await expect.element(nothingYet()).toBeInTheDocument();
		expect(charts().elements()).toHaveLength(0);
	});

	// The discriminating case: the session was filed, so a rule keyed on
	// `workouts.length === 0` would clear the empty state into four blank charts.
	it('says so still when the only session filed logged nothing', async () => {
		tend.state.workouts = [filed(false)];
		await render(ProgressPage);
		await expect.element(nothingYet()).toBeInTheDocument();
		// Read once rather than retried: the claim is that the charts never
		// arrive, and a retried assertion would only prove they were not there yet.
		expect(charts().elements()).toHaveLength(0);
	});

	it('charts the session once a set was actually ticked', async () => {
		tend.state.workouts = [filed(true)];
		await render(ProgressPage);
		await expect.element(charts()).toBeInTheDocument();
		expect(nothingYet().elements()).toHaveLength(0);
	});
});
