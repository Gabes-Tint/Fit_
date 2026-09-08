import { describe, expect, it } from 'vitest';
import { calendarWeeks } from './training-plan';
import {
	loadTrend,
	personalRecords,
	summaryNote,
	trainedExercises,
	volumeByGroup,
	weeklyAdherence,
	weekSpan
} from './training-progress';
import type { LoadUnit, MuscleGroup, PlannedDay, Workout, WorkoutSet } from './types';
import { addDaysISO } from './utils';

/** Week 1 of the 2026 training year opens on 5 January; week 2 on the 12th. */
const WEEK_1 = '2026-01-05';
const WEEK_1_AGAIN = '2026-01-08';
const WEEK_2 = '2026-01-12';
const WEEK_3 = '2026-01-19';
/** The last week of the 2025 training year, which runs into 4 January 2026. */
const LAST_WEEK_2025 = '2025-12-29';
/** The last week of the 2026 training year. */
const LAST_WEEK_2026 = '2026-12-28';

function set(load: number, reps = 8, done = true): WorkoutSet {
	return { reps, load, done };
}

function ex(name: string, group: MuscleGroup, sets: WorkoutSet[]) {
	return { name, group, sets, note: '' };
}

let counter = 0;

function done(date: string, exercises: ReturnType<typeof ex>[]): Workout {
	counter += 1;
	return {
		id: `w-${counter}`,
		routineId: 'push',
		routineName: 'Push',
		date,
		startedAt: 0,
		finishedAt: 1,
		exerciseIndex: 0,
		exercises
	};
}

/** A session that was started and walked away from: not evidence of anything. */
function abandoned(date: string, exercises: ReturnType<typeof ex>[]): Workout {
	return { ...done(date, exercises), finishedAt: null };
}

/**
 * A session that was finished with nothing ticked. It is filed, because turning
 * up happened, but it is not a set, a record, a point or a session done.
 */
function empty(date: string, exercises: ReturnType<typeof ex>[]): Workout {
	return done(
		date,
		exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, done: false })) }))
	);
}

describe('the load trend', () => {
	it('takes the heaviest ticked set of the week', () => {
		const trend = loadTrend(
			[done(WEEK_1, [ex('Squat', 'Legs', [set(60), set(80), set(70)])])],
			'Squat'
		);
		expect(trend).toEqual([{ year: 2026, week: 1, label: 'W1', load: 80 }]);
	});

	it('ignores a heavier set that was never ticked', () => {
		const trend = loadTrend(
			[done(WEEK_1, [ex('Squat', 'Legs', [set(60), set(100, 8, false)])])],
			'Squat'
		);
		expect(trend).toEqual([{ year: 2026, week: 1, label: 'W1', load: 60 }]);
	});

	it('merges two sessions in the same week into one point', () => {
		const trend = loadTrend(
			[
				done(WEEK_1, [ex('Squat', 'Legs', [set(60)])]),
				done(WEEK_1_AGAIN, [ex('Squat', 'Legs', [set(75)])]),
				done(WEEK_2, [ex('Squat', 'Legs', [set(65)])])
			],
			'Squat'
		);
		expect(trend).toEqual([
			{ year: 2026, week: 1, label: 'W1', load: 75 },
			{ year: 2026, week: 2, label: 'W2', load: 65 }
		]);
	});

	it('leaves an unfinished session out of the line', () => {
		const trend = loadTrend(
			[
				done(WEEK_1, [ex('Squat', 'Legs', [set(60)])]),
				abandoned(WEEK_2, [ex('Squat', 'Legs', [set(200)])])
			],
			'Squat'
		);
		expect(trend).toEqual([{ year: 2026, week: 1, label: 'W1', load: 60 }]);
	});

	it('runs oldest to newest whatever order the sessions arrive in', () => {
		const trend = loadTrend(
			[
				done(WEEK_3, [ex('Squat', 'Legs', [set(70)])]),
				done(WEEK_1, [ex('Squat', 'Legs', [set(60)])])
			],
			'Squat'
		);
		expect(trend.map((p) => p.label)).toEqual(['W1', 'W3']);
	});

	it('keeps only the last few weeks asked for', () => {
		const workouts = [WEEK_1, WEEK_2, WEEK_3].map((date, i) =>
			done(date, [ex('Squat', 'Legs', [set(60 + i * 5)])])
		);
		expect(loadTrend(workouts, 'Squat', 2)).toEqual([
			{ year: 2026, week: 2, label: 'W2', load: 65 },
			{ year: 2026, week: 3, label: 'W3', load: 70 }
		]);
	});

	it('shows seven weeks when nobody said how many', () => {
		const workouts = Array.from({ length: 9 }, (_, i) =>
			done(addDaysISO(WEEK_1, i * 7), [ex('Squat', 'Legs', [set(60 + i)])])
		);
		expect(loadTrend(workouts, 'Squat').map((p) => p.label)).toEqual([
			'W3',
			'W4',
			'W5',
			'W6',
			'W7',
			'W8',
			'W9'
		]);
	});

	it('keeps a week of one year apart from the same week of the next', () => {
		// 29 December 2025 is week 52 of the 2025 training year; 5 January 2026 is
		// week 1 of the next. Sorted by week number alone the gain reads as a loss.
		const trend = loadTrend(
			[
				done(LAST_WEEK_2025, [ex('Bench Press', 'Chest', [set(100)])]),
				done(WEEK_1, [ex('Bench Press', 'Chest', [set(105)])])
			],
			'Bench Press'
		);
		expect(trend).toEqual([
			{ year: 2025, week: 52, label: 'W52', load: 100 },
			{ year: 2026, week: 1, label: 'W1', load: 105 }
		]);
	});

	it('does not merge the same week number from two different years', () => {
		const trend = loadTrend(
			[
				done(LAST_WEEK_2025, [ex('Bench Press', 'Chest', [set(100)])]),
				done(LAST_WEEK_2026, [ex('Bench Press', 'Chest', [set(90)])])
			],
			'Bench Press'
		);
		expect(trend).toEqual([
			{ year: 2025, week: 52, label: 'W52', load: 100 },
			{ year: 2026, week: 52, label: 'W52', load: 90 }
		]);
	});

	it('draws no point for a filed session where nothing was ticked', () => {
		const trend = loadTrend(
			[
				done(WEEK_1, [ex('Bench', 'Chest', [set(40)])]),
				empty(WEEK_2, [ex('Bench', 'Chest', [set(60)])])
			],
			'Bench'
		);
		expect(trend).toEqual([{ year: 2026, week: 1, label: 'W1', load: 40 }]);
	});

	it('has no line for a movement that was never lifted', () => {
		expect(loadTrend([done(WEEK_1, [ex('Squat', 'Legs', [set(60)])])], 'Bench Press')).toEqual([]);
		expect(loadTrend([], 'Squat')).toEqual([]);
	});

	it('has no line for a movement opened but never ticked', () => {
		const workouts = [done(WEEK_1, [ex('Squat', 'Legs', [set(60, 8, false)])])];
		expect(loadTrend(workouts, 'Squat')).toEqual([]);
	});
});

describe('the span a trend covers', () => {
	it('counts the weeks between the first point and the last, gaps included', () => {
		const workouts = [
			done(WEEK_1, [ex('Squat', 'Legs', [set(60)])]),
			done(addDaysISO(WEEK_1, 14 * 7), [ex('Squat', 'Legs', [set(70)])])
		];
		const trend = loadTrend(workouts, 'Squat');
		expect(trend.map((p) => p.week)).toEqual([1, 15]);
		expect(weekSpan(trend)).toBe(15);
	});

	it('counts one week for a single point', () => {
		expect(weekSpan(loadTrend([done(WEEK_1, [ex('Squat', 'Legs', [set(60)])])], 'Squat'))).toBe(1);
	});

	it('counts across the turn of the year rather than backwards', () => {
		const trend = loadTrend(
			[
				done(LAST_WEEK_2025, [ex('Squat', 'Legs', [set(60)])]),
				done(WEEK_1, [ex('Squat', 'Legs', [set(65)])])
			],
			'Squat'
		);
		expect(weekSpan(trend)).toBe(2);
	});

	it('counts nothing when there is no trend', () => {
		expect(weekSpan([])).toBe(0);
	});
});

describe('the movements worth charting', () => {
	it('puts the most often trained first', () => {
		const workouts = [
			done(WEEK_1, [ex('Squat', 'Legs', [set(60)]), ex('Bench Press', 'Chest', [set(40)])]),
			done(WEEK_2, [ex('Squat', 'Legs', [set(65)])])
		];
		expect(trainedExercises(workouts)).toEqual(['Squat', 'Bench Press']);
	});

	it('breaks a tie by name rather than by chance', () => {
		const workouts = [
			done(WEEK_1, [ex('Squat', 'Legs', [set(60)]), ex('Bench Press', 'Chest', [set(40)])])
		];
		expect(trainedExercises(workouts)).toEqual(['Bench Press', 'Squat']);
	});

	it('leaves out a movement that was opened and skipped', () => {
		const workouts = [
			done(WEEK_1, [ex('Squat', 'Legs', [set(60)]), ex('Leg Curl', 'Legs', [set(30, 8, false)])])
		];
		expect(trainedExercises(workouts)).toEqual(['Squat']);
	});

	it('leaves out an unfinished session', () => {
		expect(trainedExercises([abandoned(WEEK_1, [ex('Squat', 'Legs', [set(60)])])])).toEqual([]);
	});
});

describe('volume by muscle group', () => {
	const workouts = [
		done(WEEK_1, [
			ex('Squat', 'Legs', [set(60), set(60), set(60)]),
			ex('Bench Press', 'Chest', [set(40), set(40, 8, false)])
		]),
		done(WEEK_2, [ex('Squat', 'Legs', [set(65)])])
	];

	it('counts the ticked sets under each group', () => {
		expect(volumeByGroup(workouts, WEEK_1)).toEqual([
			{ group: 'Legs', sets: 4, pct: 100 },
			{ group: 'Chest', sets: 1, pct: 25 }
		]);
	});

	it('ignores anything trained before the window opens', () => {
		expect(volumeByGroup(workouts, WEEK_2)).toEqual([{ group: 'Legs', sets: 1, pct: 100 }]);
	});

	it('ignores an unfinished session', () => {
		const only = [abandoned(WEEK_1, [ex('Squat', 'Legs', [set(60)])])];
		expect(volumeByGroup(only, WEEK_1)).toEqual([]);
	});

	it('adds nothing for a filed session where nothing was ticked', () => {
		expect(
			volumeByGroup(
				[
					done(WEEK_1, [ex('Bench', 'Chest', [set(40)])]),
					empty(WEEK_2, [ex('Squat', 'Legs', [set(60)])])
				],
				WEEK_1
			)
		).toEqual([{ group: 'Chest', sets: 1, pct: 100 }]);
	});

	it('has nothing to draw when nothing was ticked', () => {
		expect(
			volumeByGroup([done(WEEK_1, [ex('Squat', 'Legs', [set(60, 8, false)])])], WEEK_1)
		).toEqual([]);
		expect(volumeByGroup([], WEEK_1)).toEqual([]);
	});
});

describe('weekly adherence', () => {
	const weeks = calendarWeeks(2026);
	/**
	 * Week 1 asks for three sessions across three days, week 4 for two on one
	 * day — a lift and a run — and weeks 2 and 3 for nothing at all.
	 */
	const plan: PlannedDay[] = [
		{ date: '2026-01-05', routineIds: ['push'] },
		{ date: '2026-01-07', routineIds: ['push'] },
		{ date: '2026-01-09', routineIds: ['push'] },
		{ date: '2026-01-26', routineIds: ['legs', 'run'] },
		{ date: '2025-01-13', routineIds: ['push'] }
	];

	function adherence(workouts: Workout[], count = 4) {
		return weeklyAdherence({ workouts, plan, weeks, throughWeek: 4, count });
	}

	it('asks for as many sessions as the week has routines on its days', () => {
		expect(adherence([]).map((w) => w.planned)).toEqual([3, 0, 0, 2]);
	});

	// The point of counting routines rather than days: two sessions on one day is
	// two sessions, which is the whole reason a day holds a list.
	it('counts a day holding two routines twice', () => {
		expect(adherence([])[3]?.planned).toBe(2);
	});

	it('asks for nothing in a week nobody planned', () => {
		const rows = adherence([]);
		expect(rows[1]).toEqual({ week: 2, label: 'Week 2', planned: 0, done: 0 });
		expect(rows[2]?.planned).toBe(0);
	});

	it('counts the sessions actually finished in each week', () => {
		const rows = adherence([
			done(WEEK_1, [ex('Squat', 'Legs', [set(60)])]),
			done(WEEK_1_AGAIN, [ex('Squat', 'Legs', [set(60)])]),
			done(WEEK_2, [ex('Squat', 'Legs', [set(60)])])
		]);
		expect(rows.map((w) => w.done)).toEqual([2, 1, 0, 0]);
	});

	it('does not count an unfinished session as training done', () => {
		expect(adherence([abandoned(WEEK_1, [ex('Squat', 'Legs', [set(60)])])])[0]?.done).toBe(0);
	});

	// An empty session is filed so the summary can say so. Counting it here would
	// let a planned week be met by walking in and straight back out again.
	it('does not count a filed session where nothing was ticked', () => {
		expect(
			adherence([empty(WEEK_1, [ex('Bench', 'Chest', [set(40)])])]).map((w) => w.done)
		).toEqual([0, 0, 0, 0]);
	});

	it('counts the sessions that did log something in a week that also has an empty one', () => {
		const workouts = [
			done(WEEK_1, [ex('Bench', 'Chest', [set(40)])]),
			empty(WEEK_1_AGAIN, [ex('Bench', 'Chest', [set(40)])])
		];
		expect(adherence(workouts).map((w) => w.done)).toEqual([1, 0, 0, 0]);
	});

	// Both ends of the week are inside it: a session on the Sunday that closes
	// week 1 belongs to week 1, not to nothing.
	it('counts a session trained on the last day of the week', () => {
		expect(adherence([done('2026-01-11', [ex('Squat', 'Legs', [set(60)])])])[0]?.done).toBe(1);
		expect(adherence([done('2026-01-12', [ex('Squat', 'Legs', [set(60)])])])[0]?.done).toBe(0);
	});

	it('ignores a session from outside the weeks it was given', () => {
		expect(adherence([done('2025-06-01', [ex('Squat', 'Legs', [set(60)])])])[0]?.done).toBe(0);
	});

	it('ignores a day planned outside the weeks it was given', () => {
		// 13 January 2025 sits in the 2025 training year, and its sessions must not
		// be added to the 2025-dated stretch of any 2026 week.
		expect(adherence([]).reduce((total, w) => total + w.planned, 0)).toBe(5);
	});

	it('stops at the week it was asked to report through', () => {
		expect(adherence([], 52).map((w) => w.week)).toEqual([1, 2, 3, 4]);
	});

	it('shows only the last few weeks', () => {
		expect(adherence([], 2).map((w) => w.week)).toEqual([3, 4]);
	});

	it('shows four weeks when nobody said how many', () => {
		const rows = weeklyAdherence({ workouts: [], plan, weeks, throughWeek: 10 });
		expect(rows.map((w) => w.week)).toEqual([7, 8, 9, 10]);
	});

	it('labels each row by its week number', () => {
		expect(adherence([]).map((w) => w.label)).toEqual(['Week 1', 'Week 2', 'Week 3', 'Week 4']);
	});
});

describe('personal records', () => {
	const workouts = [
		done(WEEK_1, [
			ex('Squat', 'Legs', [set(80, 5), set(100, 3)]),
			ex('Pull-up', 'Back', [set(0, 12)]),
			ex('Bench Press', 'Chest', [set(60, 6)])
		]),
		done(WEEK_2, [ex('Squat', 'Legs', [set(90, 4)])])
	];

	it('keeps the heaviest ticked set of each movement', () => {
		expect(personalRecords(workouts, 2)).toEqual([
			{ name: 'Squat', load: 100, reps: 3, date: WEEK_1 },
			{ name: 'Bench Press', load: 60, reps: 6, date: WEEK_1 }
		]);
	});

	it('has no record to set for a bodyweight movement', () => {
		expect(personalRecords(workouts).map((r) => r.name)).not.toContain('Pull-up');
	});

	it('ignores a heavy set that was never ticked', () => {
		const only = [done(WEEK_1, [ex('Squat', 'Legs', [set(60), set(200, 1, false)])])];
		expect(personalRecords(only)).toEqual([{ name: 'Squat', load: 60, reps: 8, date: WEEK_1 }]);
	});

	it('ignores an unfinished session', () => {
		expect(personalRecords([abandoned(WEEK_1, [ex('Squat', 'Legs', [set(60)])])])).toEqual([]);
	});

	it('shows only as many records as it was asked for', () => {
		expect(personalRecords(workouts, 1)).toHaveLength(1);
		expect(personalRecords(workouts, 5)).toHaveLength(2);
	});

	it('sets no record from a filed session where nothing was ticked', () => {
		expect(personalRecords([empty(WEEK_1, [ex('Bench', 'Chest', [set(100)])])])).toEqual([]);
	});

	it('shows three records when nobody said how many', () => {
		const many = [
			done(WEEK_1, [
				ex('Squat', 'Legs', [set(100)]),
				ex('Deadlift', 'Legs', [set(120)]),
				ex('Bench Press', 'Chest', [set(60)]),
				ex('Barbell Curl', 'Biceps', [set(20)])
			])
		];
		expect(personalRecords(many).map((r) => r.name)).toEqual(['Deadlift', 'Squat', 'Bench Press']);
	});
});

describe('the summary note', () => {
	/** Three weeks of pressing against a thinner week of legs. */
	function history() {
		return [
			done(WEEK_1, [
				ex('Bench Press', 'Chest', [set(40), set(40)]),
				ex('Squat', 'Legs', [set(60)])
			]),
			done(WEEK_3, [
				ex('Bench Press', 'Chest', [set(47.5), set(45)]),
				ex('Squat', 'Legs', [set(60)])
			])
		];
	}

	function note(workouts: Workout[], unit: LoadUnit = 'kg') {
		return summaryNote({ workouts, unit, sinceISO: WEEK_1 });
	}

	it('says how much heavier the charted movement is, and which group is thin', () => {
		expect(note(history())).toBe(
			'Bench Press is 7.5 kg heavier than 2 weeks ago. Legs are still the thin part of the plan.'
		);
	});

	// 40 kg to 47.5 kg is 88.2 lb to 104.7 lb: the same lift, converted, not the
	// same digits with a different word after them.
	it('converts the change into whatever unit is set', () => {
		expect(note(history(), 'lb')).toBe(
			'Bench Press is 16.5 lb heavier than 2 weeks ago. Legs are still the thin part of the plan.'
		);
	});

	it('says lighter when the top set has come down', () => {
		const workouts = [
			done(WEEK_1, [
				ex('Bench Press', 'Chest', [set(45), set(45)]),
				ex('Squat', 'Legs', [set(60)])
			]),
			done(WEEK_3, [ex('Bench Press', 'Chest', [set(40), set(40)]), ex('Squat', 'Legs', [set(60)])])
		];
		expect(note(workouts)).toBe(
			'Bench Press is 5 kg lighter than 2 weeks ago. Legs are still the thin part of the plan.'
		);
	});

	// The span counts both end weeks; what the sentence points at is the week the
	// first bar was lifted in, which is one fewer.
	it('counts back to the week the first bar was lifted in, not the length of the chart', () => {
		const workouts = [
			done(WEEK_1, [
				ex('Bench Press', 'Chest', [set(40), set(40)]),
				ex('Squat', 'Legs', [set(60)])
			]),
			done(WEEK_2, [ex('Bench Press', 'Chest', [set(45), set(45)]), ex('Squat', 'Legs', [set(60)])])
		];
		expect(note(workouts)).toBe(
			'Bench Press is 5 kg heavier than 1 week ago. Legs are still the thin part of the plan.'
		);
	});

	it('says nothing about the load when the movement has only one week behind it', () => {
		const workouts = [
			done(WEEK_1, [ex('Bench Press', 'Chest', [set(40), set(40)]), ex('Squat', 'Legs', [set(60)])])
		];
		expect(note(workouts)).toBe('Legs are still the thin part of the plan.');
	});

	it('says nothing about the load when the top set has not moved', () => {
		const workouts = [
			done(WEEK_1, [
				ex('Bench Press', 'Chest', [set(40), set(40)]),
				ex('Squat', 'Legs', [set(60)])
			]),
			done(WEEK_3, [ex('Bench Press', 'Chest', [set(40), set(40)]), ex('Squat', 'Legs', [set(60)])])
		];
		expect(note(workouts)).toBe('Legs are still the thin part of the plan.');
	});

	it('agrees with the group name about singular and plural', () => {
		const workouts = [
			done(WEEK_1, [ex('Squat', 'Legs', [set(60), set(60)])]),
			done(WEEK_3, [ex('Squat', 'Legs', [set(70), set(70)]), ex('Bench Press', 'Chest', [set(40)])])
		];
		expect(note(workouts)).toBe(
			'Squat is 10 kg heavier than 2 weeks ago. Chest is still the thin part of the plan.'
		);
	});

	it('names no thin group when only one group has been trained', () => {
		const workouts = [
			done(WEEK_1, [ex('Bench Press', 'Chest', [set(40)])]),
			done(WEEK_3, [ex('Bench Press', 'Chest', [set(47.5)])])
		];
		expect(note(workouts)).toBe('Bench Press is 7.5 kg heavier than 2 weeks ago.');
	});

	it('leaves the volume half out when the window opened after the training', () => {
		expect(summaryNote({ workouts: history(), unit: 'kg', sinceISO: LAST_WEEK_2026 })).toBe(
			'Bench Press is 7.5 kg heavier than 2 weeks ago.'
		);
	});

	it('has nothing to say with no training behind it', () => {
		expect(note([])).toBe('');
	});

	it('has nothing to say about a session where nothing was ticked', () => {
		expect(note([empty(WEEK_1, [ex('Bench Press', 'Chest', [set(40)])])])).toBe('');
	});
});
