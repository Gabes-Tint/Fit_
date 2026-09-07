/**
 * Rung 1 → 2: a plan of weeks becomes a plan of days.
 *
 * Version 1 stored one routine id per calendar week and worked out which days of
 * that week you trained from the routine's `freq`, spreading the sessions evenly
 * — three a week drew Monday, Wednesday, Friday. Version 2 stores the days
 * themselves, because a person picks them and the app should not be guessing.
 *
 * So the rule is: put each planned week's routine on exactly the days version 1
 * would have drawn for it. Nothing is dropped and nothing moves — the week strip
 * and the year grid mark the same days after the upgrade as they did before it,
 * which is the only version of "your data is unchanged" a person can check by
 * looking. A rest week drew no days then and holds none now, which is how the
 * `'rest'` id retires without leaving a hole behind it.
 *
 * Version 1's arithmetic is written out below rather than imported — its own
 * date helpers included. It is gone from the live code, and it has to stay gone:
 * a rung means what it meant on the day it shipped, so a later change to how the
 * app numbers its weeks, or to the shared date helpers, must not reach back and
 * move dates this rung already wrote. It also keeps the ladder's dependencies
 * where they are, which is what decides the reach of the mutation lane that
 * guards it.
 */

type Document = Record<string, unknown>;

/** What version 1 called a routine, as far as this rung needs to read one. */
type RoutineV1 = { id?: unknown; freq?: unknown };

/** What version 1 called a planned week. */
type PlannedWeekV1 = { year?: unknown; week?: unknown; routineId?: unknown };

/** A local date as `YYYY-MM-DD`, which is how every date in the document is written. */
function isoOf(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/** The date some days after another, rolled over month and year ends by `Date` itself. */
function dayAfter(start: Date, days: number): string {
	return isoOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days));
}

/** Version 1's first Monday of the year — the day its week 1 began on. */
function firstMondayOf(year: number): Date {
	// getDay() is Sunday-based; this is the offset to the Monday on or after Jan 1.
	const offset = (8 - new Date(year, 0, 1).getDay()) % 7;
	return new Date(year, 0, 1 + offset);
}

/**
 * Version 1's even spread of `freq` sessions across a week, Monday first: three
 * a week drew Monday, Wednesday, Friday. A frequency past seven fills the week
 * and stops; `Array.from` reads a negative or non-numeric length as none, so a
 * nonsense one in a stored document draws no days rather than throwing.
 */
function spreadOverWeek(freq: number): number[] {
	const count = Math.min(7, Math.floor(freq));
	return Array.from({ length: count }, (_, i) => Math.floor((i * 7) / count));
}

/**
 * How often each routine ran, which is the only thing version 1 knew about its
 * days. Filed under whatever the row called an id, checked for nothing: a plan
 * names its routine with a string, so a row filed under anything else is simply
 * never asked for.
 */
function frequencies(routines: unknown): Map<unknown, number> {
	const found = new Map<unknown, number>();
	if (!Array.isArray(routines)) return found;
	for (const routine of routines as unknown[]) {
		const { id, freq } = (routine ?? {}) as RoutineV1;
		if (typeof freq === 'number') found.set(id, freq);
	}
	return found;
}

/** The same routines with the field that no longer describes them taken off. */
function withoutFrequency(routines: unknown): unknown {
	if (!Array.isArray(routines)) return routines;
	return (routines as unknown[]).map((routine) => {
		if (routine === null || typeof routine !== 'object') return routine;
		const kept: Document = { ...(routine as Document) };
		delete kept['freq'];
		return kept;
	});
}

/** Where one version-1 planned week put its routine: the routine paired with each date it drew. */
function placementsOf(
	planned: unknown,
	freqOf: Map<unknown, number>
): { date: string; routineId: string }[] {
	const { year, week, routineId } = (planned ?? {}) as PlannedWeekV1;
	if (typeof year !== 'number' || typeof week !== 'number' || typeof routineId !== 'string') {
		return [];
	}
	// A rest week, or a week naming a routine that is no longer in the rotation:
	// version 1 had no frequency to draw days from for either, and drew none.
	const freq = freqOf.get(routineId) ?? 0;
	const monday = firstMondayOf(year);
	const offset = (week - 1) * 7;
	return spreadOverWeek(freq).map((day) => ({ date: dayAfter(monday, offset + day), routineId }));
}

function plannedDays(document: Document): { date: string; routineIds: string[] }[] {
	const weeks = document['trainingPlan'];
	if (!Array.isArray(weeks)) return [];
	const freqOf = frequencies(document['routines']);
	const byDate = new Map<string, string[]>();
	for (const planned of weeks as unknown[]) {
		for (const { date, routineId } of placementsOf(planned, freqOf)) {
			const on = byDate.get(date) ?? [];
			// The same routine planned twice on one date is one session, not two.
			if (!on.includes(routineId)) on.push(routineId);
			byDate.set(date, on);
		}
	}
	return [...byDate]
		.map(([date, routineIds]) => ({ date, routineIds }))
		.sort((a, b) => a.date.localeCompare(b.date));
}

export function migrate_1_to_2(document: Document): Document {
	return {
		...document,
		schemaVersion: 2,
		routines: withoutFrequency(document['routines']),
		trainingPlan: plannedDays(document)
	};
}
