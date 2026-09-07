import { addDaysISO, parseISODate } from '$lib/domain/utils';

const MONTHS_SHORT = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

export const MONTHS_LONG = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

/** Monday first, because a training week starts where the plan does. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * 52 whole weeks from the first Monday of January, not ISO-8601 numbering.
 * The planner draws each week as a full seven-day row in one year, so a part
 * week at either end is not allowed; the days after week 52 fall into week 52.
 */
export const WEEKS_IN_YEAR = 52;

export type CalendarWeek = {
	/** 1-based, so it reads as "week 34" rather than as an index. */
	week: number;
	/** Month the week starts in, 0-based, which is the month it is filed under. */
	month: number;
	startISO: string;
	endISO: string;
	/** "Aug 17–23", or "Aug 31–Sep 6" when the week straddles two months. */
	label: string;
};

function firstMondayISO(year: number): string {
	const jan1 = new Date(year, 0, 1);
	// getDay() is Sunday-based; this is the offset to the Monday on or after it.
	const offset = (8 - jan1.getDay()) % 7;
	return addDaysISO(`${year}-01-01`, offset);
}

export function calendarWeeks(year: number): CalendarWeek[] {
	const start = firstMondayISO(year);
	return Array.from({ length: WEEKS_IN_YEAR }, (_, i) => {
		const startISO = addDaysISO(start, i * 7);
		const endISO = addDaysISO(startISO, 6);
		const from = parseISODate(startISO);
		const to = parseISODate(endISO);
		const tail =
			from.getMonth() === to.getMonth()
				? String(to.getDate())
				: `${MONTHS_SHORT[to.getMonth()]} ${to.getDate()}`;
		return {
			week: i + 1,
			month: from.getMonth(),
			startISO,
			endISO,
			label: `${MONTHS_SHORT[from.getMonth()]} ${from.getDate()}–${tail}`
		};
	});
}

/**
 * Which week of the training year a date falls in. Days before the year's first
 * Monday belong to the last week of the year before; the stray days after
 * week 52 stay in week 52.
 */
export function weekOf(iso: string): { year: number; week: number } {
	const year = parseISODate(iso).getFullYear();
	const days = daysBetween(firstMondayISO(year), iso);
	if (days < 0) return { year: year - 1, week: WEEKS_IN_YEAR };
	return { year, week: Math.min(WEEKS_IN_YEAR, Math.floor(days / 7) + 1) };
}

/**
 * Whole days between two dates, computed from UTC calendar dates rather than
 * instants, so a daylight-saving shift cannot cost the count an hour.
 */
function daysBetween(fromISO: string, toISO: string): number {
	const from = parseISODate(fromISO);
	const to = parseISODate(toISO);
	const ms =
		Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
		Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
	return ms / 86_400_000;
}
