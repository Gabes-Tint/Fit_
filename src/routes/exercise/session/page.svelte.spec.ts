import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Routine } from '$lib/domain/types';
import { todayISO } from '$lib/domain/utils';
import { workoutFromRoutine } from '$lib/domain/workout';
import { tend } from '$lib/state/tend.svelte';
import SessionPage from './+page.svelte';

/**
 * The session note: one field for the whole trip, which is the claim that only
 * the whole page can make. `SessionExercise.svelte.spec.ts` proves the block
 * carries none; this proves the page carries exactly one, and that it writes to
 * the workout rather than to whichever exercise is on screen (#477).
 *
 * Named `page.svelte.spec.ts`, not `+page.svelte.spec.ts`: SvelteKit reserves
 * the `+` prefix, so a `+`-prefixed spec in a route dir is rejected by the
 * route manifest.
 */

function fullBody(): Routine {
	return {
		id: 'r-1',
		name: 'Full body',
		exercises: [
			{ name: 'Squat', group: 'Legs', sets: 2, reps: 8, load: 60 },
			{ name: 'Bench Press', group: 'Chest', sets: 2, reps: 10, load: 45 },
			{ name: 'Seated Row', group: 'Back', sets: 2, reps: 10, load: 40 }
		],
		deletedAt: null
	};
}

function startSession() {
	const routine = fullBody();
	tend.state.routines = [routine];
	tend.state.activeWorkout = workoutFromRoutine(routine, {
		id: 'w-now',
		date: todayISO(),
		startedAt: Date.now() - 60_000
	});
	tend.persist();
}

function session() {
	const workout = tend.state.activeWorkout;
	if (!workout) throw new Error('test expects a running session');
	return workout;
}

beforeEach(() => {
	localStorage.clear();
	tend.resetAll();
	startSession();
});

describe('the live session screen', () => {
	it('offers one Notes field for the session, not one per exercise', async () => {
		await render(SessionPage);
		expect(page.getByRole('region').elements()).toHaveLength(3);
		expect(page.getByLabelText('Notes').elements()).toHaveLength(1);
	});

	it('asks about the session rather than the movement', async () => {
		await render(SessionPage);
		await expect.element(page.getByPlaceholder('How did the session go?')).toBeInTheDocument();
	});

	it('writes what is typed onto the workout, and onto no exercise', async () => {
		await render(SessionPage);
		await page.getByLabelText('Notes').fill('Left shoulder pinching — kept it short.');
		expect(session().note).toBe('Left shoulder pinching — kept it short.');
		for (const exercise of session().exercises) expect(exercise).not.toHaveProperty('note');
	});

	// Ticking a set rewrites the workout the page reads, and the field's value
	// is read back off it — so a note held only in the DOM would be wiped here.
	it('keeps the note on screen when a set is ticked afterwards', async () => {
		await render(SessionPage);
		const notes = page.getByLabelText('Notes');
		await notes.fill('Felt heavy throughout');
		await page
			.getByRole('region', { name: 'Bench Press' })
			.getByRole('button', {
				name: 'Set 1 done'
			})
			.click();
		expect(session().exercises[1]?.sets[0]?.done).toBe(true);
		await expect.element(notes).toHaveValue('Felt heavy throughout');
	});
});
