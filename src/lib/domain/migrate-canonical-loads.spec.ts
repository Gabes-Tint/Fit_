import { describe, expect, it } from 'vitest';
import { migrate_3_to_4 } from './migrate-canonical-loads';
import { displayLoad } from './units';

/** Kilograms in one pound, written out here too so the spec does not check the rung against itself. */
const KG_PER_LB = 0.45359237;

/** A version-3 document from an account that read its loads in pounds. */
const V3_IN_POUNDS = {
	schemaVersion: 3,
	loadUnit: 'lb',
	routines: [
		{
			id: 'push',
			name: 'Push',
			deletedAt: null,
			exercises: [
				{ name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 137.5 },
				{ name: 'Push-up', group: 'Chest', sets: 3, reps: 12, load: 0 }
			]
		}
	],
	workouts: [
		{
			id: 'w-1',
			routineId: 'push',
			exercises: [{ name: 'Bench Press', sets: [{ reps: 8, load: 135, done: true }] }]
		}
	],
	activeWorkout: {
		id: 'w-2',
		routineId: 'push',
		exercises: [{ name: 'Bench Press', sets: [{ reps: 5, load: 225, done: false }] }]
	},
	pantry: ['oats']
};

type Row = { load?: unknown };

function routineLoads(document: Record<string, unknown>): unknown[] {
	const routines = migrate_3_to_4(document)['routines'] as { exercises: Row[] }[];
	return routines.flatMap((r) => r.exercises.map((e) => e.load));
}

function filedSetLoads(document: Record<string, unknown>): unknown[] {
	const workouts = migrate_3_to_4(document)['workouts'] as { exercises: { sets: Row[] }[] }[];
	return workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets.map((s) => s.load)));
}

function activeSetLoads(document: Record<string, unknown>): unknown[] {
	const active = migrate_3_to_4(document)['activeWorkout'] as { exercises: { sets: Row[] }[] };
	return active.exercises.flatMap((e) => e.sets.map((s) => s.load));
}

describe('an account that read its loads in pounds', () => {
	it('has every routine load written as the mass it always was', () => {
		expect(routineLoads(V3_IN_POUNDS)).toEqual([137.5 * KG_PER_LB, 0]);
	});

	it('has the sets of a filed session converted with it', () => {
		expect(filedSetLoads(V3_IN_POUNDS)).toEqual([135 * KG_PER_LB]);
	});

	it('has the session still in progress converted too, not left behind', () => {
		expect(activeSetLoads(V3_IN_POUNDS)).toEqual([225 * KG_PER_LB]);
	});

	it('reads every load back as exactly the number that was entered', () => {
		const before = [137.5, 0, 135, 225];
		const after = [
			...routineLoads(V3_IN_POUNDS),
			...filedSetLoads(V3_IN_POUNDS),
			...activeSetLoads(V3_IN_POUNDS)
		];

		expect(after.map((kg) => displayLoad(kg as number, 'lb'))).toEqual(before);
	});

	it('leaves bodyweight at exactly zero rather than a rounded nothing', () => {
		expect(Object.is(routineLoads(V3_IN_POUNDS)[1], 0)).toBe(true);
	});

	it('keeps the preference, which now says how a load reads rather than what it means', () => {
		expect(migrate_3_to_4(V3_IN_POUNDS)['loadUnit']).toBe('lb');
	});

	it('touches nothing outside the loads', () => {
		expect(migrate_3_to_4(V3_IN_POUNDS)['pantry']).toEqual(['oats']);
	});
});

describe('an account that read its loads in kilograms', () => {
	const V3_IN_KILOGRAMS = { ...V3_IN_POUNDS, loadUnit: 'kg' };

	it('is left with the numbers it already had, because they were kilograms', () => {
		expect(routineLoads(V3_IN_KILOGRAMS)).toEqual([137.5, 0]);
		expect(filedSetLoads(V3_IN_KILOGRAMS)).toEqual([135]);
		expect(activeSetLoads(V3_IN_KILOGRAMS)).toEqual([225]);
	});

	it('changes nothing but the version it declares', () => {
		expect(migrate_3_to_4(V3_IN_KILOGRAMS)).toEqual({ ...V3_IN_KILOGRAMS, schemaVersion: 4 });
	});

	it('is what a document with no preference at all is read as, rather than converted on a guess', () => {
		const noPreference = { schemaVersion: 3, routines: V3_IN_POUNDS.routines };

		expect(routineLoads(noPreference)).toEqual([137.5, 0]);
	});
});

describe('what the rung refuses to repair', () => {
	const malformed = {
		schemaVersion: 3,
		loadUnit: 'lb',
		routines: 'none',
		workouts: [null, 7, { exercises: 'none' }, { exercises: [{ sets: [null, 'set'] }] }],
		activeWorkout: null
	};

	it('leaves a routine list that is not one as it found it, for the shape check to refuse', () => {
		expect(migrate_3_to_4(malformed)['routines']).toBe('none');
	});

	it('leaves rows that are not workouts, exercise lists that are not lists, and sets that are not sets', () => {
		expect(migrate_3_to_4(malformed)['workouts']).toEqual([
			null,
			7,
			{ exercises: 'none' },
			{ exercises: [{ sets: [null, 'set'] }] }
		]);
	});

	it('carries an absent active workout without inventing one', () => {
		expect(migrate_3_to_4(malformed)['activeWorkout']).toBeNull();
	});

	// Asserted by identity, not by value: a row rewritten with the same number in
	// it would read the same and still be a row this rung had no business
	// touching. The bodyweight case is the one that matters — a zero multiplied
	// by anything is still a zero, so only identity can tell the two apart.
	it('hands back the very row it was given when there is no finite load to convert', () => {
		const bodyweight = { name: 'Pull-up', load: 0 };
		const nonsense = { name: 'Bench Press', load: 'heavy' };
		const infinite = { name: 'Squat', load: Number.POSITIVE_INFINITY };
		const notANumber = { name: 'Row', load: Number.NaN };
		const noLoadAtAll = { name: 'Plank' };
		const odd = {
			schemaVersion: 3,
			loadUnit: 'lb',
			routines: [{ exercises: [bodyweight, nonsense, infinite, notANumber, noLoadAtAll] }]
		};

		const exercises = (migrate_3_to_4(odd)['routines'] as { exercises: Row[] }[])[0]?.exercises;

		expect(exercises).toEqual([bodyweight, nonsense, infinite, notANumber, noLoadAtAll]);
		expect(exercises?.[0]).toBe(bodyweight);
		expect(exercises?.[1]).toBe(nonsense);
		expect(exercises?.[2]).toBe(infinite);
		expect(exercises?.[3]).toBe(notANumber);
		expect(exercises?.[4]).toBe(noLoadAtAll);
	});

	it('carries a document with no training in it at all', () => {
		expect(migrate_3_to_4({ schemaVersion: 3, loadUnit: 'lb' })).toEqual({
			schemaVersion: 4,
			loadUnit: 'lb',
			routines: undefined,
			workouts: undefined,
			activeWorkout: undefined
		});
	});
});

describe('the rung itself', () => {
	it('stamps the version it upgraded to', () => {
		expect(migrate_3_to_4(V3_IN_POUNDS)['schemaVersion']).toBe(4);
	});

	it('runs pure: the document it was handed is not touched', () => {
		const before = JSON.stringify(V3_IN_POUNDS);

		migrate_3_to_4(V3_IN_POUNDS);

		expect(JSON.stringify(V3_IN_POUNDS)).toBe(before);
	});

	// The rung it matters most for: converting twice would halve every load, which
	// is the silent rewriting of somebody's history this rung exists to end.
	it('runs idempotent: applied to its own output it converts nothing a second time', () => {
		const once = migrate_3_to_4(V3_IN_POUNDS);

		expect(migrate_3_to_4(once)).toEqual(once);
	});
});
