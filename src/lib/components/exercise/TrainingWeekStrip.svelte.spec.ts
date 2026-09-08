import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { PlannedDay, Routine, Workout } from '$lib/domain/types';
import { addDaysISO } from '$lib/domain/utils';
import { dayStripLabel, dayStripRange } from '$lib/domain/week-strip';
import TrainingWeekStrip from './TrainingWeekStrip.svelte';

/** An arbitrary Tuesday; the routines below sit a few days either side of it. */
const TODAY = '2026-01-06';
const MONDAY = addDaysISO(TODAY, -1);
const WEDNESDAY = addDaysISO(TODAY, 1);
const FRIDAY = addDaysISO(TODAY, 3);

const push: Routine = {
	id: 'push',
	name: 'Chest & Shoulders',
	exercises: [{ name: 'Bench Press', group: 'Chest', sets: 4, reps: 8, load: 45 }],
	deletedAt: null
};

function filed(date: string, done: boolean): Workout {
	return {
		id: `w-${date}`,
		routineId: 'push',
		routineName: 'Chest & Shoulders',
		date,
		startedAt: 0,
		finishedAt: 1,
		exerciseIndex: 0,
		exercises: [
			{ name: 'Bench Press', group: 'Chest', note: '', sets: [{ reps: 8, load: 45, done }] }
		]
	};
}

/** A session that was trained: something was ticked off in it. */
function finished(date: string): Workout {
	return filed(date, true);
}

/** A session that was opened, walked out of, and filed with nothing ticked. */
function walkedOut(date: string): Workout {
	return filed(date, false);
}

const run: Routine = {
	id: 'run',
	name: 'Easy run',
	exercises: [{ name: 'Squat', group: 'Legs', sets: 1, reps: 1, load: 0 }],
	deletedAt: null
};

/** Monday, Wednesday and Friday around today hold the one routine. */
const plan: PlannedDay[] = [
	{ date: MONDAY, routineIds: ['push'] },
	{ date: WEDNESDAY, routineIds: ['push'] },
	{ date: FRIDAY, routineIds: ['push'] }
];
const base = { routines: [push], plan, workouts: [], today: TODAY };

/** The strip's full range: 30 days back through 7 days forward from today. */
const RANGE_LENGTH = dayStripRange(TODAY).length;
/** Days with nothing on them, once the three planned days above are removed. */
const REST_DAY_COUNT = RANGE_LENGTH - plan.length;

/** The small filled markers, which is how a day says it happened. */
function markers(className: string) {
	return document.querySelectorAll(`.size-1\\.5.${className}`);
}

describe('TrainingWeekStrip', () => {
	it('spans well beyond a single week, both before and after today', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		expect(document.querySelectorAll('a').length).toBeGreaterThanOrEqual(RANGE_LENGTH);
		const threeWeeksBack = addDaysISO(TODAY, -21);
		const threeWeeksAhead = addDaysISO(TODAY, 7);
		await expect
			.element(page.getByRole('link', { name: new RegExp(`^${dayStripLabel(threeWeeksBack)},`) }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: new RegExp(`^${dayStripLabel(threeWeeksAhead)},`) }))
			.toBeInTheDocument();
	});

	it('names the current day rather than its weekday', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		await expect.element(page.getByText('Today', { exact: true })).toBeInTheDocument();
		expect(page.getByText(dayStripLabel(TODAY), { exact: true }).elements()).toHaveLength(0);
	});

	it('labels a day other than today by weekday and date', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		await expect
			.element(page.getByText(dayStripLabel(MONDAY), { exact: true }))
			.toBeInTheDocument();
	});

	it('marks the days the routine was actually put on', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		expect(page.getByText('C', { exact: true }).elements()).toHaveLength(3);
	});

	it('leaves the days between them empty', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		expect(page.getByText('·', { exact: true }).elements()).toHaveLength(REST_DAY_COUNT);
	});

	it('draws both initials, in order, on a day holding two routines', async () => {
		await render(TrainingWeekStrip, {
			props: {
				...base,
				routines: [push, run],
				plan: [{ date: MONDAY, routineIds: ['push', 'run'] }]
			}
		});
		await expect.element(page.getByText('CE', { exact: true })).toBeInTheDocument();
	});

	it('names both of a day’s routines in the order they are trained', async () => {
		await render(TrainingWeekStrip, {
			props: {
				...base,
				routines: [push, run],
				plan: [{ date: MONDAY, routineIds: ['push', 'run'] }]
			}
		});
		await expect
			.element(
				page.getByRole('link', {
					name: `${dayStripLabel(MONDAY)}, Chest & Shoulders, then Easy run`,
					exact: true
				})
			)
			.toBeInTheDocument();
	});

	it('leaves the whole strip empty when nothing is planned', async () => {
		await render(TrainingWeekStrip, { props: { ...base, plan: [] } });
		expect(page.getByText('·', { exact: true }).elements()).toHaveLength(RANGE_LENGTH);
	});

	// The dot carried a text color, which paints nothing on an empty span, so a
	// planned day drew a blank where the other two states drew a mark.
	it('draws the dot on a planned day that has not been trained yet', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		expect(markers('border-primary')).toHaveLength(3);
	});

	// Outline for planned, filled for done. The two cannot be told apart by
	// strength of the same color — the tones are not all dark enough to survive
	// being washed out, so shape carries it.
	it('tells a planned day apart from one already trained', async () => {
		await render(TrainingWeekStrip, {
			props: { ...base, today: WEDNESDAY, workouts: [finished(MONDAY)] }
		});
		expect(markers('bg-primary')).toHaveLength(1);
		expect(markers('border-primary')).toHaveLength(1);
	});

	it('fills in a day earlier that was trained', async () => {
		await render(TrainingWeekStrip, {
			props: { ...base, today: WEDNESDAY, workouts: [finished(MONDAY)] }
		});
		expect(markers('bg-primary')).toHaveLength(1);
	});

	it('leaves an earlier day that was skipped unfilled', async () => {
		await render(TrainingWeekStrip, { props: { ...base, today: WEDNESDAY } });
		expect(markers('bg-primary')).toHaveLength(0);
	});

	// A filed empty session is not a trained day here.
	it('leaves a day where nothing was ticked unmarked', async () => {
		await render(TrainingWeekStrip, {
			props: { ...base, today: WEDNESDAY, workouts: [walkedOut(MONDAY)] }
		});
		expect(markers('bg-primary')).toHaveLength(0);
		// Read once, not retried: the claim is that "trained" never appears.
		expect(page.getByRole('link', { name: /trained$/ }).elements()).toHaveLength(0);
	});

	it('marks only the day that was trained when an empty session sits beside it', async () => {
		await render(TrainingWeekStrip, {
			props: { ...base, today: WEDNESDAY, workouts: [finished(MONDAY), walkedOut(TODAY)] }
		});
		await expect
			.element(
				page.getByRole('link', {
					name: `${dayStripLabel(MONDAY)}, Chest & Shoulders, trained`,
					exact: true
				})
			)
			.toBeInTheDocument();
		expect(page.getByRole('link', { name: /trained$/ }).elements()).toHaveLength(1);
	});

	it('claims nothing about a day that has not happened yet', async () => {
		await render(TrainingWeekStrip, {
			props: { ...base, today: MONDAY, workouts: [finished(WEDNESDAY)] }
		});
		expect(markers('bg-primary')).toHaveLength(0);
	});

	it('sends anyone who disagrees with the strip to the planner', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		await expect
			.element(page.getByRole('link', { name: 'Edit plan' }))
			.toHaveAttribute('href', '/exercise/plan');
	});

	it('makes every day of the strip a control that reaches the planner', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		const links = page.getByRole('link').elements();
		// The full range, plus the 'Edit plan' link above it.
		expect(links).toHaveLength(RANGE_LENGTH + 1);
		for (const link of links) {
			expect(link.getAttribute('href')).toBe('/exercise/plan');
			// Keyboard-reachable, which a div dressed as a cell was not.
			expect(link.tabIndex).toBe(0);
		}
	});

	it('tells a screen reader which day it is on and what it holds', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		await expect
			.element(
				page.getByRole('link', { name: `${dayStripLabel(MONDAY)}, Chest & Shoulders`, exact: true })
			)
			.toBeInTheDocument();
	});

	it('says plainly that a day with nothing on it holds nothing', async () => {
		await render(TrainingWeekStrip, { props: { ...base } });
		await expect
			.element(page.getByRole('link', { name: 'Today, rest day', exact: true }))
			.toBeInTheDocument();
	});

	it('calls every day a rest day when nothing is planned at all', async () => {
		await render(TrainingWeekStrip, { props: { ...base, plan: [] } });
		expect(page.getByRole('link', { name: /rest day$/ }).elements()).toHaveLength(RANGE_LENGTH);
	});

	it('says which earlier day was actually trained', async () => {
		await render(TrainingWeekStrip, {
			props: { ...base, today: WEDNESDAY, workouts: [finished(MONDAY)] }
		});
		await expect
			.element(
				page.getByRole('link', {
					name: `${dayStripLabel(MONDAY)}, Chest & Shoulders, trained`,
					exact: true
				})
			)
			.toBeInTheDocument();
		// Read once, not retried: the claim is exactly one day carries "trained".
		expect(page.getByRole('link', { name: /trained$/ }).elements()).toHaveLength(1);
	});
});
