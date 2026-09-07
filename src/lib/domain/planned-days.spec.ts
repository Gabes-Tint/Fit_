import { describe, expect, it } from 'vitest';
import {
	plannedDaysBetween,
	plannedSessionsBetween,
	routineIdsOn,
	toggleRoutineOn,
	withoutRoutine
} from './planned-days';
import type { PlannedDay } from './types';

/** A week where Monday holds two sessions and Thursday one. */
const WEEK: PlannedDay[] = [
	{ date: '2026-09-07', routineIds: ['lift', 'run'] },
	{ date: '2026-09-10', routineIds: ['lift'] }
];

describe('what a day holds', () => {
	it('names the routines in the order they are trained', () => {
		expect(routineIdsOn(WEEK, '2026-09-07')).toEqual(['lift', 'run']);
	});

	it('holds nothing on a day nobody planned, which is what rest is', () => {
		expect(routineIdsOn(WEEK, '2026-09-08')).toEqual([]);
		expect(routineIdsOn([], '2026-09-07')).toEqual([]);
	});
});

describe('what a stretch of days holds', () => {
	it('takes both ends of the range', () => {
		expect(plannedDaysBetween(WEEK, '2026-09-07', '2026-09-10')).toEqual(WEEK);
		expect(plannedDaysBetween(WEEK, '2026-09-07', '2026-09-07')).toEqual([WEEK[0]]);
		expect(plannedDaysBetween(WEEK, '2026-09-10', '2026-09-13')).toEqual([WEEK[1]]);
	});

	it('leaves out the days either side of it', () => {
		expect(plannedDaysBetween(WEEK, '2026-09-08', '2026-09-09')).toEqual([]);
		expect(plannedDaysBetween(WEEK, '2026-09-11', '2026-09-13')).toEqual([]);
	});

	it('counts sessions and not days, because a day can ask twice', () => {
		expect(plannedSessionsBetween(WEEK, '2026-09-07', '2026-09-13')).toBe(3);
		expect(plannedSessionsBetween(WEEK, '2026-09-10', '2026-09-13')).toBe(1);
		expect(plannedSessionsBetween(WEEK, '2026-09-14', '2026-09-20')).toBe(0);
	});
});

describe('putting a routine on a day', () => {
	it('plans a day that held nothing', () => {
		expect(toggleRoutineOn([], '2026-09-08', 'legs')).toEqual([
			{ date: '2026-09-08', routineIds: ['legs'] }
		]);
	});

	it('adds a second session after the first rather than replacing it', () => {
		const next = toggleRoutineOn(WEEK, '2026-09-10', 'run');

		expect(routineIdsOn(next, '2026-09-10')).toEqual(['lift', 'run']);
	});

	it('takes a routine off the day when it is already there', () => {
		const next = toggleRoutineOn(WEEK, '2026-09-07', 'lift');

		expect(routineIdsOn(next, '2026-09-07')).toEqual(['run']);
	});

	it('leaves no empty day behind when the last one comes off', () => {
		const next = toggleRoutineOn(WEEK, '2026-09-10', 'lift');

		expect(next.map((day) => day.date)).toEqual(['2026-09-07']);
	});

	it('keeps the days in date order however they were added', () => {
		const next = toggleRoutineOn(WEEK, '2026-09-08', 'legs');

		expect(next.map((day) => day.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-10']);
	});

	it('leaves the plan it was handed alone', () => {
		const before = JSON.stringify(WEEK);

		toggleRoutineOn(WEEK, '2026-09-07', 'legs');

		expect(JSON.stringify(WEEK)).toBe(before);
	});
});

describe('taking a routine out of the plan altogether', () => {
	it('drops it from every day it sat on', () => {
		const next = withoutRoutine(WEEK, 'lift');

		expect(next).toEqual([{ date: '2026-09-07', routineIds: ['run'] }]);
	});

	it('leaves the days that never held it exactly as they were', () => {
		expect(withoutRoutine(WEEK, 'swim')).toEqual(WEEK);
	});

	it('leaves the plan it was handed alone', () => {
		const before = JSON.stringify(WEEK);

		withoutRoutine(WEEK, 'lift');

		expect(JSON.stringify(WEEK)).toBe(before);
	});
});
