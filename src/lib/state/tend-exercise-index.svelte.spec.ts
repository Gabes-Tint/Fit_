import { describe, expect, it } from 'vitest';
import { TendStore } from './tend.svelte';

// The acceptance tests only call without an index while the session is on its
// first movement, where "the current exercise" and "exercise 0" are the same
// one. These move the session on first, so falling back to 0 cannot pass.
function onSecondMovement() {
	localStorage.clear();
	const store = new TendStore();
	store.hydrate();
	store.useTemplate('fb');
	store.startWorkout('full-body');
	store.nextExercise();
	return store;
}

function exercises(store: TendStore) {
	const workout = store.state.activeWorkout;
	if (!workout) throw new Error('no session is running');
	return workout.exercises;
}

describe('per-exercise actions without an exercise index, past the first movement', () => {
	it('tick, step, add, note and swap the exercise on screen', () => {
		const store = onSecondMovement();
		store.toggleSet(0);
		store.bumpSet(0, 'reps', 1);
		store.addSet();
		store.noteExercise('slow');
		store.swapExercise('Leg Press');
		const [first, second] = exercises(store);
		expect(second).toMatchObject({ name: 'Leg Press', group: 'Legs', note: 'slow' });
		expect(second?.sets).toEqual([
			{ reps: 9, load: 45, done: true },
			{ reps: 8, load: 45, done: false },
			{ reps: 8, load: 45, done: false },
			{ reps: 8, load: 45, done: false }
		]);
		expect(first).toMatchObject({ name: 'Squat', note: '' });
		expect(first?.sets).toEqual([
			{ reps: 8, load: 60, done: false },
			{ reps: 8, load: 60, done: false },
			{ reps: 8, load: 60, done: false }
		]);
	});

	it('lets an explicit index reach back to a movement already passed', () => {
		const store = onSecondMovement();
		store.toggleSet(0, 0);
		const [first, second] = exercises(store);
		expect(first?.sets[0]?.done).toBe(true);
		expect(second?.sets[0]?.done).toBe(false);
	});

	it('does nothing for a negative index', () => {
		const store = onSecondMovement();
		const before = structuredClone($state.snapshot(store.state.activeWorkout));
		store.toggleSet(0, -1);
		store.addSet(-1);
		store.noteExercise('slow', -1);
		expect($state.snapshot(store.state.activeWorkout)).toEqual(before);
	});
});
