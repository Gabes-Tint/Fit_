import { describe, expect, it } from 'vitest';
import type { Routine, Workout, WorkoutExercise, WorkoutSet } from './types';
import {
	elapsedSeconds,
	formatClock,
	formatDuration,
	lastPerformance,
	setsDone,
	workoutFromRoutine,
	workoutSetsDone,
	workoutSetsPlanned,
	workoutVolume
} from './workout';

const ROUTINE: Routine = {
	id: 'push',
	name: 'Chest & Shoulders',
	exercises: [
		{ name: 'Bench Press', group: 'Chest', sets: 3, reps: 8, load: 45 },
		{ name: 'Pull-up', group: 'Back', sets: 2, reps: 8, load: 0 }
	],
	deletedAt: null
};

const OPENED = { id: 'w-1', date: '2026-06-01', startedAt: 1_000_000 };

function set(load: number, reps: number, done: boolean): WorkoutSet {
	return { reps, load, done };
}

function exercise(name: string, sets: WorkoutSet[]): WorkoutExercise {
	return { name, group: 'Chest', sets };
}

function workout(exercises: WorkoutExercise[], overrides: Partial<Workout> = {}): Workout {
	return {
		id: 'w',
		routineId: 'push',
		routineName: 'Push',
		date: '2026-06-01',
		startedAt: 0,
		finishedAt: null,
		exerciseIndex: 0,
		note: '',
		exercises,
		...overrides
	};
}

describe('opening a routine into a workout', () => {
	it('carries the routine it was started from', () => {
		const w = workoutFromRoutine(ROUTINE, OPENED);
		expect(w.id).toBe('w-1');
		expect(w.routineId).toBe('push');
		expect(w.routineName).toBe('Chest & Shoulders');
		expect(w.date).toBe('2026-06-01');
		expect(w.startedAt).toBe(1_000_000);
	});

	it('starts unfinished, on the first movement', () => {
		const w = workoutFromRoutine(ROUTINE, OPENED);
		expect(w.finishedAt).toBeNull();
		expect(w.exerciseIndex).toBe(0);
	});

	it('writes out one set object per prescribed set', () => {
		const w = workoutFromRoutine(ROUTINE, OPENED);
		expect(w.exercises.map((e) => e.sets.length)).toEqual([3, 2]);
		expect(w.exercises[0]?.sets[0]).toEqual({ reps: 8, load: 45, done: false });
	});

	it('opens every set untouched', () => {
		const w = workoutFromRoutine(ROUTINE, OPENED);
		for (const e of w.exercises) {
			for (const s of e.sets) expect(s.done).toBe(false);
		}
	});

	it('gives each set its own object, so ticking one does not tick them all', () => {
		const w = workoutFromRoutine(ROUTINE, OPENED);
		const sets = w.exercises[0]?.sets ?? [];
		const first = sets[0];
		if (!first) throw new Error('the first movement has no sets');
		first.done = true;
		first.load = 50;
		expect(sets[1]?.done).toBe(false);
		expect(sets[1]?.load).toBe(45);
	});

	it('carries a bodyweight movement over as a zero load', () => {
		expect(workoutFromRoutine(ROUTINE, OPENED).exercises[1]?.sets[0]?.load).toBe(0);
	});

	it('opens the session note empty, and keeps no note on any exercise', () => {
		const w = workoutFromRoutine(ROUTINE, OPENED);
		expect(w.note).toBe('');
		for (const e of w.exercises) expect(e).not.toHaveProperty('note');
	});
});

describe('counting what was done', () => {
	const w = workout([
		exercise('Bench Press', [set(45, 8, true), set(45, 8, true), set(45, 6, false)]),
		exercise('Pull-up', [set(0, 8, true), set(0, 8, false)])
	]);

	it('counts only the ticked sets of one movement', () => {
		expect(setsDone(w.exercises[0]?.sets ?? [])).toBe(2);
		expect(setsDone([])).toBe(0);
	});

	it('counts the ticked sets across the session', () => {
		expect(workoutSetsDone(w)).toBe(3);
	});

	it('counts every set the session set out to do', () => {
		expect(workoutSetsPlanned(w)).toBe(5);
	});

	it('counts nothing for a session with no movements', () => {
		expect(workoutSetsDone(workout([]))).toBe(0);
		expect(workoutSetsPlanned(workout([]))).toBe(0);
	});

	it('adds up the kilograms actually moved', () => {
		expect(workoutVolume(w)).toBe(45 * 8 + 45 * 8);
	});

	it('leaves a skipped set out of the volume', () => {
		expect(workoutVolume(workout([exercise('Bench Press', [set(45, 8, false)])]))).toBe(0);
	});
});

describe('the session clock', () => {
	it('measures from the start against the clock passed in', () => {
		expect(elapsedSeconds(workout([], { startedAt: 1000 }), 91_000)).toBe(90);
	});

	it('stops at the moment the session was filed', () => {
		const w = workout([], { startedAt: 1000, finishedAt: 61_000 });
		expect(elapsedSeconds(w, 999_000)).toBe(60);
	});

	it('never reports a negative length when the clock has gone backwards', () => {
		expect(elapsedSeconds(workout([], { startedAt: 10_000 }), 1000)).toBe(0);
	});

	it('rounds down to whole seconds', () => {
		expect(elapsedSeconds(workout([], { startedAt: 0 }), 1999)).toBe(1);
	});
});

describe('formatting a clock', () => {
	it('pads the seconds so the digits do not jump', () => {
		expect(formatClock(65)).toBe('1:05');
		expect(formatClock(600)).toBe('10:00');
	});

	it('shows a standing start as zero', () => {
		expect(formatClock(0)).toBe('0:00');
	});

	it('reads a negative or fractional count as its floor, never below zero', () => {
		expect(formatClock(-30)).toBe('0:00');
		expect(formatClock(9.8)).toBe('0:09');
	});

	it('keeps counting in minutes past the hour', () => {
		expect(formatClock(3661)).toBe('61:01');
	});
});

describe('formatting a duration', () => {
	it('pads both the minutes and the seconds', () => {
		expect(formatDuration(61)).toBe('0:01:01');
		expect(formatDuration(3600)).toBe('1:00:00');
	});

	it('shows nothing elapsed as zero', () => {
		expect(formatDuration(0)).toBe('0:00:00');
	});

	it('rolls over into hours', () => {
		expect(formatDuration(3661)).toBe('1:01:01');
		expect(formatDuration(7322)).toBe('2:02:02');
	});

	it('never goes below zero', () => {
		expect(formatDuration(-5)).toBe('0:00:00');
	});
});

describe('what this movement went at last time', () => {
	const earlier = workout([exercise('Bench Press', [set(40, 8, true)])], {
		date: '2026-05-01',
		finishedAt: 1
	});
	const later = workout([exercise('Bench Press', [set(45, 6, true)])], {
		date: '2026-06-01',
		finishedAt: 2
	});

	it('takes the newest session that logged it', () => {
		expect(lastPerformance([earlier, later], 'Bench Press')).toEqual({ reps: 6, load: 45 });
	});

	it('takes the first set that was actually ticked', () => {
		const w = workout([exercise('Bench Press', [set(45, 8, false), set(50, 5, true)])]);
		expect(lastPerformance([w], 'Bench Press')).toEqual({ reps: 5, load: 50 });
	});

	it('looks further back when the newest session ticked nothing', () => {
		const abandoned = workout([exercise('Bench Press', [set(60, 8, false)])], {
			date: '2026-07-01'
		});
		expect(lastPerformance([earlier, abandoned], 'Bench Press')).toEqual({ reps: 8, load: 40 });
	});

	it('has no starting point for a movement never lifted', () => {
		expect(lastPerformance([earlier], 'Squat')).toBeNull();
		expect(lastPerformance([], 'Bench Press')).toBeNull();
	});

	it('reads the named movement out of a session that trained several', () => {
		const mixed = workout([
			exercise('Squat', [set(80, 5, true)]),
			exercise('Bench Press', [set(52.5, 4, true)]),
			exercise('Pull-up', [set(0, 10, true)])
		]);
		expect(lastPerformance([mixed], 'Bench Press')).toEqual({ reps: 4, load: 52.5 });
		expect(lastPerformance([mixed], 'Squat')).toEqual({ reps: 5, load: 80 });
	});

	it("leaves the caller's history in the order it was filed", () => {
		const history = [earlier, later];
		lastPerformance(history, 'Bench Press');
		expect(history).toEqual([earlier, later]);
	});
});

describe('nextUndoneSet', () => {
	it('returns the first undone set of the first exercise that has one', async () => {
		const w = workout([
			exercise('Squat', [set(60, 8, true), set(60, 8, true), set(60, 8, false)]),
			exercise('Bench Press', [set(45, 8, true), set(45, 8, false), set(45, 8, false)]),
			exercise('Seated Row', [set(45, 10, true), set(45, 10, true), set(45, 10, true)])
		]);
		const mod = await import('./workout');
		expect(mod.nextUndoneSet).toBeDefined();
		expect(mod.nextUndoneSet(w)).toEqual({ exerciseIndex: 0, setIndex: 2 });
	});

	it('returns null when every set is done', async () => {
		const w = workout([
			exercise('Squat', [set(60, 8, true), set(60, 8, true), set(60, 8, true)]),
			exercise('Bench Press', [set(45, 8, true), set(45, 8, true), set(45, 8, true)]),
			exercise('Seated Row', [set(45, 10, true), set(45, 10, true), set(45, 10, true)])
		]);
		const mod = await import('./workout');
		expect(mod.nextUndoneSet).toBeDefined();
		expect(mod.nextUndoneSet(w)).toBeNull();
	});

	it('finds the first undone set in routine order', async () => {
		const w = workout([
			exercise('Squat', [set(60, 8, true), set(60, 8, true), set(60, 8, true)]),
			exercise('Bench Press', [set(45, 8, false), set(45, 8, true), set(45, 8, true)]),
			exercise('Seated Row', [set(45, 10, false), set(45, 10, false), set(45, 10, true)])
		]);
		const mod = await import('./workout');
		expect(mod.nextUndoneSet).toBeDefined();
		expect(mod.nextUndoneSet(w)).toEqual({ exerciseIndex: 1, setIndex: 0 });
	});

	it('returns null for an empty workout', async () => {
		const w = workout([]);
		const mod = await import('./workout');
		expect(mod.nextUndoneSet).toBeDefined();
		expect(mod.nextUndoneSet(w)).toBeNull();
	});
});

describe('setCounts', () => {
	it('returns done and total sets counted across all exercises', async () => {
		const w = workout([
			exercise('Squat', [set(60, 8, true), set(60, 8, true), set(60, 8, false)]),
			exercise('Bench Press', [set(45, 8, true), set(45, 8, false), set(45, 8, false)]),
			exercise('Seated Row', [set(45, 10, true), set(45, 10, true), set(45, 10, true)])
		]);
		const mod = await import('./workout');
		expect(mod.setCounts).toBeDefined();
		expect(mod.setCounts(w)).toEqual({ done: 6, total: 9 });
	});

	it('counts nothing for an empty workout', async () => {
		const w = workout([]);
		const mod = await import('./workout');
		expect(mod.setCounts).toBeDefined();
		expect(mod.setCounts(w)).toEqual({ done: 0, total: 0 });
	});

	it('counts zero done sets when nothing is ticked', async () => {
		const w = workout([
			exercise('Squat', [set(60, 8, false), set(60, 8, false), set(60, 8, false)]),
			exercise('Bench Press', [set(45, 8, false), set(45, 8, false)])
		]);
		const mod = await import('./workout');
		expect(mod.setCounts).toBeDefined();
		expect(mod.setCounts(w)).toEqual({ done: 0, total: 5 });
	});

	it('counts all sets done when every one is ticked', async () => {
		const w = workout([
			exercise('Squat', [set(60, 8, true), set(60, 8, true), set(60, 8, true)]),
			exercise('Bench Press', [set(45, 8, true), set(45, 8, true)])
		]);
		const mod = await import('./workout');
		expect(mod.setCounts).toBeDefined();
		expect(mod.setCounts(w)).toEqual({ done: 5, total: 5 });
	});
});
