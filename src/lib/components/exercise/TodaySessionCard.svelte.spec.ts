import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { PlannedDay, Routine, Workout } from '$lib/domain/types';
import TodaySessionCard from './TodaySessionCard.svelte';

/** Week 1 of 2026 runs Monday the 5th to Sunday the 11th. */
const MONDAY = '2026-01-05';
const TUESDAY = '2026-01-06';
const WEDNESDAY = '2026-01-07';
const THURSDAY = '2026-01-08';

function routine(id: string, name: string, moves: number): Routine {
	return {
		id,
		name,
		exercises: Array.from({ length: moves }, (_, i) => ({
			name: `Move ${i + 1}`,
			group: 'Chest',
			sets: 3,
			reps: 10,
			load: 20
		}))
	};
}

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
			{ name: 'Bench Press', group: 'Chest', note: '', sets: [{ reps: 8, load: 40, done }] }
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

const push = routine('push', 'Chest & Shoulders', 5);
const legs = routine('legs', 'Legs', 5);
const plan: PlannedDay[] = [{ date: MONDAY, routineIds: ['push'] }];
const noop = () => {};

const base = {
	routines: [push, legs],
	plan,
	workouts: [],
	today: MONDAY,
	onstart: noop,
	onpick: noop,
	onopen: noop
};

/** Same id and name as `push`, but nothing on it to run. */
const bare = routine('push', 'Chest & Shoulders', 0);

describe('TodaySessionCard', () => {
	it('names the routine the plan calls for today', async () => {
		await render(TodaySessionCard, { props: { ...base } });
		await expect
			.element(page.getByRole('heading', { name: 'Chest & Shoulders', level: 2 }))
			.toBeInTheDocument();
	});

	it('says what the session costs before it is started', async () => {
		await render(TodaySessionCard, { props: { ...base } });
		await expect
			.element(page.getByText('5 exercises · 15 sets · about 48 min'))
			.toBeInTheDocument();
	});

	it('previews the first four movements and stops there', async () => {
		await render(TodaySessionCard, { props: { ...base } });
		await expect.element(page.getByText('Move 4', { exact: true })).toBeInTheDocument();
		expect(page.getByText('Move 5', { exact: true }).elements()).toHaveLength(0);
	});

	it('previews a routine that asks for the same movement twice', async () => {
		const twice: Routine = {
			id: 'push',
			name: 'Chest & Shoulders',
			exercises: [
				{ name: 'Bench Press', group: 'Chest', sets: 3, reps: 10, load: 60 },
				{ name: 'Incline Bench Press', group: 'Chest', sets: 3, reps: 10, load: 40 },
				{ name: 'Bench Press', group: 'Chest', sets: 3, reps: 8, load: 65 }
			]
		};
		await render(TodaySessionCard, { props: { ...base, routines: [twice, legs] } });
		expect(page.getByText('Bench Press', { exact: true }).elements()).toHaveLength(2);
	});

	it('starts the routine the plan chose', async () => {
		const onstart = vi.fn();
		await render(TodaySessionCard, { props: { ...base, onstart } });
		await page.getByRole('button', { name: 'Start session' }).click();
		expect(onstart).toHaveBeenCalledWith('push');
	});

	it('opens the whole routine for anyone who wants to read it first', async () => {
		await render(TodaySessionCard, { props: { ...base } });
		await expect
			.element(page.getByRole('link', { name: 'See the whole routine' }))
			.toHaveAttribute('href', '/exercise/routines/push');
	});

	it('calls a day with nothing on it a rest day', async () => {
		await render(TodaySessionCard, { props: { ...base, today: TUESDAY } });
		await expect
			.element(page.getByRole('heading', { name: 'Rest day', level: 2 }))
			.toBeInTheDocument();
		await expect.element(page.getByText('The calendar has nothing scheduled.')).toBeInTheDocument();
	});

	it('rests when nothing is planned at all', async () => {
		await render(TodaySessionCard, { props: { ...base, plan: [] } });
		await expect
			.element(page.getByRole('heading', { name: 'Rest day', level: 2 }))
			.toBeInTheDocument();
	});

	it('says what the week already holds, in the singular', async () => {
		await render(TodaySessionCard, {
			props: { ...base, today: TUESDAY, workouts: [finished(MONDAY)] }
		});
		await expect.element(page.getByText(/1 session done this week already/)).toBeInTheDocument();
	});

	it('counts more than one session done this week', async () => {
		await render(TodaySessionCard, {
			props: { ...base, today: THURSDAY, workouts: [finished(MONDAY), finished(WEDNESDAY)] }
		});
		await expect.element(page.getByText(/2 sessions done this week already/)).toBeInTheDocument();
	});

	// A walked-out session is filed but doesn't count the week as met.
	it('does not count a session where nothing was ticked', async () => {
		await render(TodaySessionCard, {
			props: { ...base, today: TUESDAY, workouts: [walkedOut(MONDAY)] }
		});
		await expect.element(page.getByText('The calendar has nothing scheduled.')).toBeInTheDocument();
		// Read once, not retried: the claim is the line never appears.
		expect(page.getByText(/done this week already/).elements()).toHaveLength(0);
	});

	it('counts only the sessions that were trained, alongside an empty one', async () => {
		await render(TodaySessionCard, {
			props: {
				...base,
				today: THURSDAY,
				workouts: [finished(MONDAY), walkedOut(WEDNESDAY)]
			}
		});
		await expect.element(page.getByText(/1 session done this week already/)).toBeInTheDocument();
	});

	it('ignores a workout from an earlier week', async () => {
		await render(TodaySessionCard, {
			props: { ...base, today: TUESDAY, workouts: [finished('2026-01-01')] }
		});
		await expect.element(page.getByText('The calendar has nothing scheduled.')).toBeInTheDocument();
	});

	it('trains the first routine in the rotation when someone trains anyway', async () => {
		const onstart = vi.fn();
		await render(TodaySessionCard, { props: { ...base, today: TUESDAY, onstart } });
		await page.getByRole('button', { name: 'Train anyway' }).click();
		expect(onstart).toHaveBeenCalledWith('push');
	});

	it('falls back to the first routine whatever order the rotation is in', async () => {
		const onstart = vi.fn();
		await render(TodaySessionCard, {
			props: { ...base, routines: [legs, push], plan: [], onstart }
		});
		await page.getByRole('button', { name: 'Train anyway' }).click();
		expect(onstart).toHaveBeenCalledWith('legs');
	});

	it('refuses to start today’s routine when nothing is on it', async () => {
		await render(TodaySessionCard, { props: { ...base, routines: [bare, legs] } });
		await expect.element(page.getByRole('button', { name: 'Start session' })).toBeDisabled();
	});

	it('refuses to train anyway on a routine with nothing on it', async () => {
		await render(TodaySessionCard, {
			props: { ...base, today: TUESDAY, routines: [bare, legs] }
		});
		await expect.element(page.getByRole('button', { name: 'Train anyway' })).toBeDisabled();
	});

	it('still starts a routine that does have exercises on it', async () => {
		await render(TodaySessionCard, { props: { ...base } });
		await expect.element(page.getByRole('button', { name: 'Start session' })).toBeEnabled();
	});

	it('leads with the first session of a day that holds two', async () => {
		const twoUp: PlannedDay[] = [{ date: MONDAY, routineIds: ['legs', 'push'] }];
		await render(TodaySessionCard, { props: { ...base, plan: twoUp } });
		await expect.element(page.getByRole('heading', { name: 'Legs', level: 2 })).toBeInTheDocument();
		await expect.element(page.getByText('Today’s sessions')).toBeInTheDocument();
	});

	it('names the later session of the day, and what it asks for', async () => {
		const twoUp: PlannedDay[] = [{ date: MONDAY, routineIds: ['legs', 'push'] }];
		await render(TodaySessionCard, { props: { ...base, plan: twoUp } });
		await expect.element(page.getByText('then Chest & Shoulders')).toBeInTheDocument();
		await expect
			.element(page.getByText('5 exercises · 15 sets', { exact: true }))
			.toBeInTheDocument();
	});

	it('starts the first of the day, not the second', async () => {
		const onstart = vi.fn();
		const twoUp: PlannedDay[] = [{ date: MONDAY, routineIds: ['legs', 'push'] }];
		await render(TodaySessionCard, { props: { ...base, plan: twoUp, onstart } });
		await page.getByRole('button', { name: 'Start session' }).click();
		expect(onstart).toHaveBeenCalledWith('legs');
	});

	it('says "session" in the singular when the day holds only one', async () => {
		await render(TodaySessionCard, { props: { ...base } });
		await expect.element(page.getByText('Today’s session')).toBeInTheDocument();
		expect(page.getByText(/^then /).elements()).toHaveLength(0);
	});

	it('leaves out a routine the plan names but the rotation no longer has', async () => {
		const dangling: PlannedDay[] = [{ date: MONDAY, routineIds: ['push', 'deleted'] }];
		await render(TodaySessionCard, { props: { ...base, plan: dangling } });
		await expect.element(page.getByText('Today’s session')).toBeInTheDocument();
	});

	it('says there is nothing to run rather than showing a rest day', async () => {
		await render(TodaySessionCard, { props: { ...base, routines: [], plan: [] } });
		await expect
			.element(page.getByRole('heading', { name: 'No routines yet', level: 2 }))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					'A routine is the list of exercises for one session. Start from a template, or build your own.'
				)
			)
			.toBeInTheDocument();
		expect(page.getByRole('heading', { name: 'Rest day' }).elements()).toHaveLength(0);
	});

	it('offers the starters to anyone with no routines', async () => {
		const onpick = vi.fn();
		await render(TodaySessionCard, { props: { ...base, routines: [], plan: [], onpick } });
		await page.getByRole('button', { name: 'Pick a starter' }).click();
		expect(onpick).toHaveBeenCalledTimes(1);
	});

	it('offers a blank routine to anyone who wants to build their own', async () => {
		const onopen = vi.fn();
		await render(TodaySessionCard, { props: { ...base, routines: [], plan: [], onopen } });
		await page.getByRole('button', { name: 'Build one' }).click();
		expect(onopen).toHaveBeenCalledTimes(1);
	});

	it('keeps the rest-day controls off the empty card', async () => {
		await render(TodaySessionCard, { props: { ...base, routines: [], plan: [] } });
		expect(page.getByRole('button', { name: 'Train anyway' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: 'Change the plan' }).elements()).toHaveLength(0);
	});

	it('keeps the starter controls off a real rest day', async () => {
		await render(TodaySessionCard, { props: { ...base, today: TUESDAY } });
		expect(page.getByRole('button', { name: 'Pick a starter' }).elements()).toHaveLength(0);
		expect(page.getByRole('button', { name: 'Build one' }).elements()).toHaveLength(0);
	});

	it('leads to the planner when the rest day is the wrong one', async () => {
		await render(TodaySessionCard, { props: { ...base, today: TUESDAY } });
		await expect
			.element(page.getByRole('link', { name: 'Change the plan' }))
			.toHaveAttribute('href', '/exercise/plan');
	});
});
