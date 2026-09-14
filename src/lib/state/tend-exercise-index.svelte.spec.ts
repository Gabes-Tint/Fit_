import { describe, expect, it } from 'vitest';
import { TendStore } from './tend.svelte';

function inSession() {
	localStorage.clear();
	const store = new TendStore();
	store.hydrate();
	store.useTemplate('fb');
	store.startWorkout('full-body');
	return store;
}

function exercises(store: TendStore) {
	const workout = store.state.activeWorkout;
	if (!workout) throw new Error('no session is running');
	return workout.exercises;
}

describe('per-exercise actions given an exercise index', () => {
	// The session's own pointer is moved away from the exercise named, so an
	// action that read the pointer instead of its argument would miss.
	it('act on the exercise named, wherever the session points', () => {
		const store = inSession();
		if (store.state.activeWorkout) store.state.activeWorkout.exerciseIndex = 1;
		store.toggleSet(0, 0);
		store.bumpSet(0, 'reps', 1, 0);
		store.addSet(0);
		store.noteExercise('slow', 0);
		store.swapExercise('Leg Press', 0);
		const [first, second] = exercises(store);
		expect(first).toMatchObject({ name: 'Leg Press', group: 'Legs', note: 'slow' });
		expect(first?.sets).toEqual([
			{ reps: 9, load: 60, done: true },
			{ reps: 8, load: 60, done: false },
			{ reps: 8, load: 60, done: false },
			{ reps: 8, load: 60, done: false }
		]);
		expect(second).toMatchObject({ name: 'Bench Press', note: '' });
		expect(second?.sets).toEqual([
			{ reps: 8, load: 45, done: false },
			{ reps: 8, load: 45, done: false },
			{ reps: 8, load: 45, done: false }
		]);
	});

	it('do nothing for a negative index', () => {
		const store = inSession();
		const before = $state.snapshot(store.state.activeWorkout);
		store.toggleSet(0, -1);
		store.bumpSet(0, 'load', 1, -1);
		store.addSet(-1);
		store.noteExercise('slow', -1);
		store.swapExercise('Leg Press', -1);
		expect($state.snapshot(store.state.activeWorkout)).toEqual(before);
	});
});
