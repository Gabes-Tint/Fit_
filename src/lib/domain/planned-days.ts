import type { PlannedDay } from '$lib/domain/types';

/**
 * The training plan read and written a day at a time.
 *
 * A date with no entry is a rest day. Nothing here ever stores an empty list,
 * because then there would be two ways to say "nothing planned" and they would
 * eventually disagree; absence is the only one. Days are kept in date order, so
 * two devices that plan the same day arrive at the same array rather than at two
 * orderings of it.
 */

/** The routines planned for one date, in the order they are meant to be trained. */
export function routineIdsOn(plan: PlannedDay[], date: string): string[] {
	return plan.find((day) => day.date === date)?.routineIds ?? [];
}

/** The days holding something between two dates, both ends included. */
export function plannedDaysBetween(
	plan: PlannedDay[],
	fromISO: string,
	toISO: string
): PlannedDay[] {
	return plan.filter((day) => day.date >= fromISO && day.date <= toISO);
}

/**
 * Sessions the plan asks for over a stretch of days. A day carrying a morning
 * lift and an evening run asks for two, which is why this counts routines and
 * not days.
 */
export function plannedSessionsBetween(plan: PlannedDay[], fromISO: string, toISO: string): number {
	return plannedDaysBetween(plan, fromISO, toISO).reduce(
		(total, day) => total + day.routineIds.length,
		0
	);
}

/**
 * Put a routine on a day, or take it off again if it is already there. A routine
 * added second stays second: the order is the order of the day.
 */
export function toggleRoutineOn(plan: PlannedDay[], date: string, routineId: string): PlannedDay[] {
	const on = routineIdsOn(plan, date);
	const next = on.includes(routineId) ? on.filter((id) => id !== routineId) : [...on, routineId];
	const others = plan.filter((day) => day.date !== date);
	return sorted(next.length > 0 ? [...others, { date, routineIds: next }] : others);
}

/** Every trace of a routine taken out of the plan, for when the routine itself goes. */
export function withoutRoutine(plan: PlannedDay[], routineId: string): PlannedDay[] {
	return plan.flatMap((day) => {
		const routineIds = day.routineIds.filter((id) => id !== routineId);
		return routineIds.length > 0 ? [{ ...day, routineIds }] : [];
	});
}

function sorted(plan: PlannedDay[]): PlannedDay[] {
	return [...plan].sort((a, b) => a.date.localeCompare(b.date));
}
