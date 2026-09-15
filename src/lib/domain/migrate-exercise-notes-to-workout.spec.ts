import { describe, expect, it } from 'vitest';

describe('migration from v5 to v6: exercise notes to workout', () => {
	it('collects notes from exercises into the workout in routine order', async () => {
		const mod = await import('./migrate-exercise-notes-to-workout');
		const migrate_5_to_6 = mod.migrate_5_to_6;
		const v5Document = {
			schemaVersion: 5,
			onboarded: true,
			activeProfileId: 'p-1',
			profiles: [],
			weekPlan: [],
			pantry: [],
			routines: [],
			trainingPlan: [],
			loadUnit: 'kg',
			restSeconds: 90,
			units: 'metric',
			leftHanded: false,
			workouts: [
				{
					id: 'w-1',
					routineId: 'r-1',
					routineName: 'Upper',
					date: '2026-09-01',
					startedAt: 1000,
					finishedAt: 2000,
					exerciseIndex: 0,
					exercises: [
						{ name: 'Bench Press', group: 'Chest', note: 'felt heavy', sets: [] },
						{ name: 'Rows', group: 'Back', note: '', sets: [] },
						{ name: 'Shoulder Press', group: 'Shoulders', note: 'bit tired', sets: [] }
					]
				}
			],
			activeWorkout: null
		};
		const upgraded = migrate_5_to_6(v5Document);
		const workout = (upgraded.workouts as unknown[])[0] as Record<string, unknown> | undefined;
		if (!workout) throw new Error('workout is undefined');
		expect(workout.note).toBe('Bench Press: felt heavy\nShoulder Press: bit tired');
		const exercises = workout.exercises as unknown[];
		expect(exercises.every((e: unknown) => e && typeof e === 'object' && !('note' in e))).toBe(
			true
		);
	});

	it('sets note to empty string when all exercise notes are empty', async () => {
		const mod = await import('./migrate-exercise-notes-to-workout');
		const migrate_5_to_6 = mod.migrate_5_to_6;
		const v5Document = {
			schemaVersion: 5,
			onboarded: true,
			activeProfileId: 'p-1',
			profiles: [],
			weekPlan: [],
			pantry: [],
			routines: [],
			trainingPlan: [],
			loadUnit: 'kg',
			restSeconds: 90,
			units: 'metric',
			leftHanded: false,
			workouts: [
				{
					id: 'w-1',
					routineId: 'r-1',
					routineName: 'Upper',
					date: '2026-09-01',
					startedAt: 1000,
					finishedAt: 2000,
					exerciseIndex: 0,
					exercises: [
						{ name: 'Bench Press', group: 'Chest', note: '', sets: [] },
						{ name: 'Rows', group: 'Back', note: '', sets: [] }
					]
				}
			],
			activeWorkout: null
		};
		const upgraded = migrate_5_to_6(v5Document);
		const workout = (upgraded.workouts as unknown[])[0] as Record<string, unknown> | undefined;
		expect(workout?.note).toBe('');
	});

	it('removes note field from exercises after collecting them', async () => {
		const mod = await import('./migrate-exercise-notes-to-workout');
		const migrate_5_to_6 = mod.migrate_5_to_6;
		const v5Document = {
			schemaVersion: 5,
			onboarded: true,
			activeProfileId: 'p-1',
			profiles: [],
			weekPlan: [],
			pantry: [],
			routines: [],
			trainingPlan: [],
			loadUnit: 'kg',
			restSeconds: 90,
			units: 'metric',
			leftHanded: false,
			workouts: [
				{
					id: 'w-1',
					routineId: 'r-1',
					routineName: 'Upper',
					date: '2026-09-01',
					startedAt: 1000,
					finishedAt: 2000,
					exerciseIndex: 0,
					exercises: [
						{ name: 'Bench Press', group: 'Chest', note: 'heavy', sets: [] },
						{ name: 'Rows', group: 'Back', note: 'strained', sets: [] }
					]
				}
			],
			activeWorkout: null
		};
		const upgraded = migrate_5_to_6(v5Document);
		const workout = (upgraded.workouts as unknown[])[0] as Record<string, unknown> | undefined;
		if (!workout) throw new Error('workout is undefined');
		const exercises = workout.exercises as unknown[];
		for (const ex of exercises) {
			expect(ex && typeof ex === 'object' && 'note' in ex).toBe(false);
		}
	});

	it('upgrades activeWorkout on the same terms as filed workouts', async () => {
		const mod = await import('./migrate-exercise-notes-to-workout');
		const migrate_5_to_6 = mod.migrate_5_to_6;
		const v5Document = {
			schemaVersion: 5,
			onboarded: true,
			activeProfileId: 'p-1',
			profiles: [],
			weekPlan: [],
			pantry: [],
			routines: [],
			trainingPlan: [],
			loadUnit: 'kg',
			restSeconds: 90,
			units: 'metric',
			leftHanded: false,
			workouts: [],
			activeWorkout: {
				id: 'w-active',
				routineId: 'r-1',
				routineName: 'Upper',
				date: '2026-09-01',
				startedAt: 1000,
				finishedAt: null,
				exerciseIndex: 0,
				exercises: [
					{ name: 'Bench Press', group: 'Chest', note: 'feeling good', sets: [] },
					{ name: 'Rows', group: 'Back', note: '', sets: [] }
				]
			}
		};
		const upgraded = migrate_5_to_6(v5Document);
		const activeWorkout = upgraded.activeWorkout as Record<string, unknown>;
		expect(activeWorkout.note).toBe('Bench Press: feeling good');
		const exercises = activeWorkout.exercises as unknown[];
		expect(exercises.every((e: unknown) => e && typeof e === 'object' && !('note' in e))).toBe(
			true
		);
	});

	it('leaves a malformed workouts array unchanged', async () => {
		const mod = await import('./migrate-exercise-notes-to-workout');
		const migrate_5_to_6 = mod.migrate_5_to_6;
		const v5Document = {
			schemaVersion: 5,
			onboarded: true,
			activeProfileId: 'p-1',
			profiles: [],
			weekPlan: [],
			pantry: [],
			routines: [],
			trainingPlan: [],
			loadUnit: 'kg',
			restSeconds: 90,
			units: 'metric',
			leftHanded: false,
			workouts: 'not an array',
			activeWorkout: null
		};
		const upgraded = migrate_5_to_6(v5Document);
		expect(upgraded.workouts).toBe('not an array');
	});

	it('sets schemaVersion to 6', async () => {
		const mod = await import('./migrate-exercise-notes-to-workout');
		const migrate_5_to_6 = mod.migrate_5_to_6;
		const v5Document = {
			schemaVersion: 5,
			onboarded: true,
			activeProfileId: 'p-1',
			profiles: [],
			weekPlan: [],
			pantry: [],
			routines: [],
			trainingPlan: [],
			loadUnit: 'kg',
			restSeconds: 90,
			units: 'metric',
			leftHanded: false,
			workouts: [],
			activeWorkout: null
		};
		const upgraded = migrate_5_to_6(v5Document);
		expect(upgraded.schemaVersion).toBe(6);
	});
});

describe('what the rung refuses to repair', () => {
	/** A version-5 document with `workouts` and `activeWorkout` as handed in. */
	function v5(workouts: unknown, activeWorkout: unknown = null) {
		return {
			schemaVersion: 5,
			onboarded: true,
			activeProfileId: 'p-1',
			profiles: [],
			weekPlan: [],
			pantry: [],
			routines: [],
			trainingPlan: [],
			loadUnit: 'kg',
			restSeconds: 90,
			units: 'metric',
			leftHanded: false,
			workouts,
			activeWorkout
		};
	}

	// The same restraint as `migrate_2_to_3`: the shape check refuses a malformed
	// document a moment later, and a rung that quietly repaired one would hand
	// that check something the person never stored.
	it('leaves a workout row that is not an object exactly as it came', async () => {
		const { migrate_5_to_6 } = await import('./migrate-exercise-notes-to-workout');
		const upgraded = migrate_5_to_6(v5(['nonsense', null]));
		expect(upgraded.workouts).toEqual(['nonsense', null]);
	});

	it('leaves a workout whose exercises are not a list alone, note and all', async () => {
		const { migrate_5_to_6 } = await import('./migrate-exercise-notes-to-workout');
		const upgraded = migrate_5_to_6(v5([{ id: 'w-1', exercises: 'not a list' }]));
		expect(upgraded.workouts).toEqual([{ id: 'w-1', exercises: 'not a list' }]);
	});

	// A row that is not an object has no note to collect and none to strip, so it
	// is copied across untouched rather than spread into an object of its indices.
	it('carries an exercise that is not an object across unchanged', async () => {
		const { migrate_5_to_6 } = await import('./migrate-exercise-notes-to-workout');
		const upgraded = migrate_5_to_6(
			v5([{ id: 'w-1', exercises: [null, { name: 'Rows', note: 'ok' }] }])
		);
		expect(upgraded.workouts).toEqual([
			{ id: 'w-1', note: 'Rows: ok', exercises: [null, { name: 'Rows' }] }
		]);
	});

	it('leaves an absent session in progress absent', async () => {
		const { migrate_5_to_6 } = await import('./migrate-exercise-notes-to-workout');
		expect(migrate_5_to_6(v5([])).activeWorkout).toBeNull();
	});
});
