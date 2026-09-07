import { describe, expect, it } from 'vitest';
import { calendarWeeks, MONTHS_LONG, WEEKDAYS, weekOf, WEEKS_IN_YEAR } from './training-plan';

/** 2026 opens on a Thursday, so its training year starts on 5 January. */
const LATE_START = 2026;
/** 2024 opens on a Monday, so week 1 is January 1 and the tail runs long. */
const MONDAY_START = 2024;

describe('the calendar', () => {
	it('names twelve months and seven days, Monday first', () => {
		expect(MONTHS_LONG).toHaveLength(12);
		expect(MONTHS_LONG[0]).toBe('January');
		expect(WEEKDAYS).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
	});

	it('starts a year that opens on a Monday on the first of January', () => {
		expect(calendarWeeks(MONDAY_START)[0]?.startISO).toBe('2024-01-01');
	});

	it('waits for the first Monday in a year that does not', () => {
		expect(calendarWeeks(LATE_START)[0]?.startISO).toBe('2026-01-05');
		expect(calendarWeeks(2025)[0]?.startISO).toBe('2025-01-06');
	});
});

describe('the weeks of a training year', () => {
	it('is fifty-two whole weeks', () => {
		const weeks = calendarWeeks(LATE_START);
		expect(weeks).toHaveLength(WEEKS_IN_YEAR);
		expect(WEEKS_IN_YEAR).toBe(52);
	});

	it('numbers the weeks from one', () => {
		const weeks = calendarWeeks(LATE_START);
		expect(weeks[0]?.week).toBe(1);
		expect(weeks.at(-1)?.week).toBe(52);
	});

	it('begins on the first Monday and runs seven days at a time', () => {
		const weeks = calendarWeeks(LATE_START);
		expect(weeks[0]?.startISO).toBe('2026-01-05');
		expect(weeks[0]?.endISO).toBe('2026-01-11');
		expect(weeks[1]?.startISO).toBe('2026-01-12');
	});

	it('files a week under the month it starts in', () => {
		const weeks = calendarWeeks(LATE_START);
		expect(weeks[0]?.month).toBe(0);
		expect(weeks.at(-1)?.month).toBe(11);
	});

	it('labels a week inside one month with a bare closing date', () => {
		expect(calendarWeeks(LATE_START)[0]?.label).toBe('Jan 5–11');
	});

	it('names the second month when a week straddles two of them', () => {
		expect(calendarWeeks(LATE_START)[3]?.label).toBe('Jan 26–Feb 1');
	});
});

describe('placing a date in the plan', () => {
	it('puts a date in the week it falls in', () => {
		expect(weekOf('2026-01-05')).toEqual({ year: 2026, week: 1 });
		expect(weekOf('2026-01-11')).toEqual({ year: 2026, week: 1 });
		expect(weekOf('2026-01-12')).toEqual({ year: 2026, week: 2 });
	});

	it('gives the days before the first Monday back to the year before', () => {
		expect(weekOf('2026-01-03')).toEqual({ year: 2025, week: 52 });
		expect(weekOf('2027-01-02')).toEqual({ year: 2026, week: 52 });
	});

	it('is not moved by the clocks going forward', () => {
		// 13 April 2026 is 14 whole weeks after the first Monday, but only 97 days
		// and 23 hours after it wherever the spring change falls in between.
		expect(weekOf('2026-04-13')).toEqual({ year: 2026, week: 15 });
		expect(weekOf('2026-04-12')).toEqual({ year: 2026, week: 14 });
	});

	it('agrees with the week the calendar draws, every week of the year', () => {
		for (const week of calendarWeeks(LATE_START)) {
			expect(weekOf(week.startISO)).toEqual({ year: LATE_START, week: week.week });
			expect(weekOf(week.endISO)).toEqual({ year: LATE_START, week: week.week });
		}
	});

	it('keeps the days after week fifty-two in week fifty-two', () => {
		// 2024 starts on a Monday, so its 52 weeks end on 29 December and two
		// days are left over rather than becoming a week 53.
		expect(weekOf('2024-12-29')).toEqual({ year: 2024, week: 52 });
		expect(weekOf('2024-12-31')).toEqual({ year: 2024, week: 52 });
	});
});
