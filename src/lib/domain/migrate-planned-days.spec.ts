import { describe, expect, it } from 'vitest';
import { migrate_1_to_2 } from './migrate-planned-days';

/**
 * Version 1's routines, each carrying the frequency that decided its days, and
 * a plan of whole weeks. 2026 opens on a Thursday, so its week 1 begins on
 * Monday 5 January and week 3 on Monday 19 January.
 */
const V1 = {
	schemaVersion: 1,
	routines: [
		{ id: 'push', name: 'Push', freq: 3, exercises: [] },
		{ id: 'legs', name: 'Legs', freq: 2, exercises: [] },
		// Two rows no version-1 build wrote, but a document synced from a broken or
		// hostile client can carry: a frequency stored as text, and below, a week
		// with no year. Neither drew a day in version 1 and neither draws one now,
		// which is why the plan asserted below has nothing of theirs in it.
		{ id: 'typed-wrong', name: 'Typed wrong', freq: '2', exercises: [] }
	],
	trainingPlan: [
		{ year: 2026, week: 1, routineId: 'push' },
		{ year: 2026, week: 3, routineId: 'legs' },
		{ year: 2026, week: 5, routineId: 'typed-wrong' },
		{ week: 7, routineId: 'push' }
	]
};

type PlannedDayV2 = { date: string; routineIds: string[] };

function plan(document: Record<string, unknown>): PlannedDayV2[] {
	return migrate_1_to_2(document)['trainingPlan'] as PlannedDayV2[];
}

function week(routineId: string, freq: number, number = 1, year = 2026) {
	return {
		routines: [{ id: routineId, name: routineId, freq }],
		trainingPlan: [{ year, week: number, routineId }]
	};
}

describe('a week that named a routine', () => {
	it('becomes the days version 1 drew for it, and no others', () => {
		expect(plan(V1)).toEqual([
			{ date: '2026-01-05', routineIds: ['push'] },
			{ date: '2026-01-07', routineIds: ['push'] },
			{ date: '2026-01-09', routineIds: ['push'] },
			{ date: '2026-01-19', routineIds: ['legs'] },
			{ date: '2026-01-22', routineIds: ['legs'] }
		]);
	});

	it('spreads the sessions the way version 1 spread them', () => {
		expect(plan(week('r', 1))).toEqual([{ date: '2026-01-05', routineIds: ['r'] }]);
		expect(plan(week('r', 2))).toEqual([
			{ date: '2026-01-05', routineIds: ['r'] },
			{ date: '2026-01-08', routineIds: ['r'] }
		]);
		expect(plan(week('r', 7))).toHaveLength(7);
	});

	it('fills the week and no more when a frequency asks for more days than a week has', () => {
		expect(plan(week('r', 9)).map((day) => day.date)).toEqual([
			'2026-01-05',
			'2026-01-06',
			'2026-01-07',
			'2026-01-08',
			'2026-01-09',
			'2026-01-10',
			'2026-01-11'
		]);
	});

	it('draws no days at all for a frequency that is not a number of sessions', () => {
		expect(plan(week('r', 0))).toEqual([]);
		expect(plan(week('r', -1))).toEqual([]);
	});

	it('lands on the right Monday in a year that opens on one', () => {
		// 1 January 2024 is itself a Monday, so week 1 starts there rather than later.
		expect(plan(week('r', 1, 1, 2024))).toEqual([{ date: '2024-01-01', routineIds: ['r'] }]);
	});

	it('counts the weeks forward from week one', () => {
		expect(plan(week('r', 1, 52))).toEqual([{ date: '2026-12-28', routineIds: ['r'] }]);
	});

	it('keeps the days in date order whatever order the weeks were stored in', () => {
		const backwards = { ...V1, trainingPlan: [...V1.trainingPlan].reverse() };

		expect(plan(backwards)).toEqual(plan(V1));
	});
});

describe('a week that named no routine anyone can train', () => {
	it('drops a rest week, because version 1 drew no days for one either', () => {
		const rest = { ...V1, trainingPlan: [{ year: 2026, week: 2, routineId: 'rest' }] };

		expect(plan(rest)).toEqual([]);
	});

	it('drops a week naming a routine that is no longer in the rotation', () => {
		const dangling = { ...V1, trainingPlan: [{ year: 2026, week: 2, routineId: 'deleted' }] };

		expect(plan(dangling)).toEqual([]);
	});
});

describe('two routines that fall on the same date', () => {
	it('sit on the day in the order the plan held them', () => {
		const both = {
			routines: [
				{ id: 'lift', freq: 1 },
				{ id: 'run', freq: 1 }
			],
			trainingPlan: [
				{ year: 2026, week: 1, routineId: 'lift' },
				{ year: 2026, week: 1, routineId: 'run' }
			]
		};

		expect(plan(both)).toEqual([{ date: '2026-01-05', routineIds: ['lift', 'run'] }]);
	});

	it('are one session when they are the same routine twice', () => {
		const twice = {
			routines: [{ id: 'lift', freq: 1 }],
			trainingPlan: [
				{ year: 2026, week: 1, routineId: 'lift' },
				{ year: 2026, week: 1, routineId: 'lift' }
			]
		};

		expect(plan(twice)).toEqual([{ date: '2026-01-05', routineIds: ['lift'] }]);
	});
});

describe('the routines themselves', () => {
	it('lose the frequency and keep everything else', () => {
		expect(migrate_1_to_2(V1)['routines']).toEqual([
			{ id: 'push', name: 'Push', exercises: [] },
			{ id: 'legs', name: 'Legs', exercises: [] },
			{ id: 'typed-wrong', name: 'Typed wrong', exercises: [] }
		]);
	});

	it('are left as they are when they are not a list of routines at all', () => {
		expect(migrate_1_to_2({ routines: null })['routines']).toBeNull();
	});

	it('leave an entry that is not a routine exactly as it was found', () => {
		expect(migrate_1_to_2({ routines: [null, 'push', 7] })['routines']).toEqual([null, 'push', 7]);
	});
});

describe('a document that is not shaped the way version 1 wrote it', () => {
	it('plans nothing rather than throwing', () => {
		expect(plan({ ...V1, trainingPlan: null })).toEqual([]);
		expect(plan({ ...V1, trainingPlan: [null, 'week', 7] })).toEqual([]);
	});

	it('plans nothing when the routines are not a list to read frequencies from', () => {
		expect(plan({ ...V1, routines: null })).toEqual([]);
		expect(plan({ ...V1, routines: 'push' })).toEqual([]);
	});

	it('skips a week missing the year, the number or the routine', () => {
		expect(plan({ ...V1, trainingPlan: [{ week: 1, routineId: 'push' }] })).toEqual([]);
		expect(plan({ ...V1, trainingPlan: [{ year: 2026, routineId: 'push' }] })).toEqual([]);
		expect(plan({ ...V1, trainingPlan: [{ year: 2026, week: 1, routineId: 7 }] })).toEqual([]);
		expect(plan({ ...V1, trainingPlan: [{ year: '2026', week: 1, routineId: 'push' }] })).toEqual(
			[]
		);
	});

	it('skips a routine whose frequency is not a number', () => {
		const wrong = {
			routines: [{ id: 'push', freq: '3' }],
			trainingPlan: [{ year: 2026, week: 1, routineId: 'push' }]
		};

		expect(plan(wrong)).toEqual([]);
	});

	it('skips a routine with no id to plan it under', () => {
		const wrong = {
			routines: [{ freq: 3 }],
			trainingPlan: [{ year: 2026, week: 1, routineId: 'push' }]
		};

		expect(plan(wrong)).toEqual([]);
	});

	// A plan names its routine with a string. A week naming one any other way is
	// not naming a routine, even when a row happens to be filed under that value.
	it('skips a week whose routine is named by something that is not a name', () => {
		const wrong = {
			routines: [{ id: 7, freq: 1 }],
			trainingPlan: [{ year: 2026, week: 1, routineId: 7 }]
		};

		expect(plan(wrong)).toEqual([]);
	});
});

describe('the rung itself', () => {
	it('stamps the version it upgraded to and leaves the rest of the document alone', () => {
		const upgraded = migrate_1_to_2({ ...V1, onboarded: true, pantry: ['oats'] });

		expect(upgraded['schemaVersion']).toBe(2);
		expect(upgraded['onboarded']).toBe(true);
		expect(upgraded['pantry']).toEqual(['oats']);
	});

	it('runs pure: the document it was handed is not touched', () => {
		const before = JSON.stringify(V1);

		migrate_1_to_2(V1);

		expect(JSON.stringify(V1)).toBe(before);
	});

	it('runs deterministic: the same document twice gives the same result', () => {
		expect(migrate_1_to_2(V1)).toEqual(migrate_1_to_2(V1));
	});
});
