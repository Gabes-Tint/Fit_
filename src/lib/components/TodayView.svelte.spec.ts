import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { logFromFood } from '$lib/domain/log-entry';
import { emptyProfile } from '$lib/domain/profile';
import type { LogSource, Meal, Workout } from '$lib/domain/types';
import { addDaysISO, todayISO, weekdayLong } from '$lib/domain/utils';
import { dayStripAccessibleLabel } from '$lib/domain/week-strip';
import { logUi } from '$lib/state/log-ui.svelte';
import { tend } from '$lib/state/tend.svelte';
import { BUTTON_SIZES } from '$lib/ui/button-variants';
import TodayView from './TodayView.svelte';

/** A finished session today, the minimum a workout needs to count as training. */
function finishedWorkout(date = todayISO()): Workout {
	return {
		id: `w-${Math.random()}`,
		routineId: 'r1',
		routineName: 'Push',
		date,
		startedAt: 0,
		finishedAt: 1,
		exerciseIndex: 0,
		exercises: [
			{
				name: 'Bench Press',
				group: 'Chest',
				sets: [{ reps: 5, load: 60, done: true }],
				note: ''
			}
		]
	};
}

/** Log one catalog food, the way the sheet does it. */
function logFood(args: {
	foodId: string;
	servings: number;
	meal: Meal;
	date?: string;
	source?: LogSource;
}) {
	tend.addLogItems([
		logFromFood({ ...args, date: args.date ?? todayISO(), source: args.source ?? 'manual' })
	]);
}

function logName() {
	return tend.profile?.log[0]?.name ?? '';
}

function onboard(glp1 = false) {
	tend.resetAll();
	tend.completeOnboarding({
		profile: { ...emptyProfile({ name: 'Alex' }), glp1, goal: glp1 ? 'glp1' : 'lose' },
		household: false,
		useSample: false
	});
}

beforeEach(() => {
	localStorage.clear();
	logUi.open = false;
	logUi.meal = null;
	onboard();
});

describe('TodayView', () => {
	it('heads the page with Today', async () => {
		await render(TodayView);
		await expect
			.element(page.getByRole('heading', { name: 'Today', level: 1 }))
			.toBeInTheDocument();
	});

	it('opens with an invitation rather than a scolding when nothing is logged', async () => {
		await render(TodayView);
		await expect.element(page.getByText('Whenever you log is a good time.')).toBeInTheDocument();
	});

	it('counts logged days once there is a log', async () => {
		logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		await render(TodayView);
		await expect.element(page.getByText(/1 day logged this week/)).toBeInTheDocument();
	});

	it('pluralizes the logged-day count', async () => {
		logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		logFood({
			foodId: 'egg-large',
			servings: 2,
			meal: 'breakfast',
			date: addDaysISO(todayISO(), -1)
		});
		await render(TodayView);
		await expect.element(page.getByText(/2 days logged this week/)).toBeInTheDocument();
	});

	it('collapses an expanded entry when tapped again', async () => {
		logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		await render(TodayView);
		const row = page.getByRole('button', { name: new RegExp(logName()) }).first();
		await row.click();
		await row.click();
		expect(document.body.textContent).not.toContain('Remove');
	});

	it('steps servings in quarters on GLP-1', async () => {
		onboard(true);
		logFood({ foodId: 'egg-large', servings: 1, meal: 'breakfast' });
		await render(TodayView);
		await page
			.getByRole('button', { name: new RegExp(logName()) })
			.first()
			.click();
		await page.getByRole('button', { name: 'Increase' }).click();
		expect(tend.profile?.log[0]?.servings).toBe(1.25);
	});

	it('lists every meal section', async () => {
		await render(TodayView);
		for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
			await expect.element(page.getByRole('heading', { name: meal, level: 2 })).toBeInTheDocument();
		}
	});

	it('treats an empty meal as fine, not a failure', async () => {
		await render(TodayView);
		await expect.element(page.getByText('Nothing here. That’s fine.').first()).toBeInTheDocument();
	});

	it('shows a logged entry under its meal', async () => {
		logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		await render(TodayView);
		await expect.element(page.getByText(logName()).first()).toBeInTheDocument();
	});

	describe('Energy card layout', () => {
		it('shows Protein, Carbs and Fat bars for a calorie-led profile, with one ring', async () => {
			await render(TodayView);
			expect(document.querySelectorAll('svg.-rotate-90')).toHaveLength(1);
			await expect.element(page.getByText('Protein')).toBeInTheDocument();
			await expect.element(page.getByText('Carbs')).toBeInTheDocument();
			await expect.element(page.getByText('Fat')).toBeInTheDocument();
			await expect.element(page.getByText('Fiber')).not.toBeInTheDocument();
			expect(document.querySelector('.bg-destructive.h-full')).not.toBeNull();
			expect(document.querySelector('.bg-foreground.h-full')).not.toBeNull();
			expect(document.querySelector('.bg-ink-subtle.h-full')).not.toBeNull();
			expect(document.querySelector('.bg-sage-soft.h-full')).toBeNull();
		});

		it('shows Protein and Fiber bars for a GLP-1 profile, with one ring, and no Carbs/Fat', async () => {
			onboard(true);
			await render(TodayView);
			expect(document.querySelectorAll('svg.-rotate-90')).toHaveLength(1);
			await expect.element(page.getByText('Protein')).toBeInTheDocument();
			await expect.element(page.getByText('Fiber')).toBeInTheDocument();
			await expect.element(page.getByText('Carbs')).not.toBeInTheDocument();
			await expect.element(page.getByText('Fat')).not.toBeInTheDocument();
			expect(document.querySelector('.bg-destructive.h-full')).not.toBeNull();
			expect(document.querySelector('.bg-sage-soft.h-full')).not.toBeNull();
			expect(document.querySelector('.bg-foreground.h-full')).toBeNull();
			expect(document.querySelector('.bg-ink-subtle.h-full')).toBeNull();
		});
	});

	it('drops the single Log something button in favor of per-meal buttons', async () => {
		await render(TodayView);
		await expect
			.element(page.getByRole('button', { name: 'Log something' }))
			.not.toBeInTheDocument();
	});

	it('offers a log button after each meal heading', async () => {
		await render(TodayView);
		for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
			await expect.element(page.getByRole('button', { name: `Log ${meal}` })).toBeInTheDocument();
		}
	});

	it('opens the log sheet on the named meal from its heading button', async () => {
		await render(TodayView);
		await page.getByRole('button', { name: 'Log dinner' }).click();
		expect(logUi.open).toBe(true);
		expect(logUi.meal).toBe('dinner');
	});

	it('opens the log sheet from an empty meal slot, naming its meal', async () => {
		await render(TodayView);
		await page.getByRole('button', { name: 'Nothing here. That’s fine.' }).first().click();
		expect(logUi.open).toBe(true);
		expect(logUi.meal).toBe('breakfast');
	});

	it('expands an entry when it is tapped', async () => {
		logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		await render(TodayView);
		await page
			.getByRole('button', { name: new RegExp(logName()) })
			.first()
			.click();
		await expect.element(page.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
	});

	it('switches to another day from the week strip', async () => {
		const yesterday = addDaysISO(todayISO(), -1);
		await render(TodayView);
		await page
			.getByRole('button', {
				name: dayStripAccessibleLabel(yesterday, 'nothing logged', false),
				exact: true
			})
			.click();
		await expect
			.element(page.getByText(weekdayLong(yesterday).toUpperCase(), { exact: false }))
			.toBeInTheDocument();
	});

	it('renders nothing when there is no active profile', async () => {
		tend.resetAll();
		await render(TodayView);
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('totals energy per meal', async () => {
		logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast' });
		await render(TodayView);
		const kcal = tend.profile?.log[0]?.kcal ?? 0;
		await expect.element(page.getByText(`${kcal} kcal`).first()).toBeInTheDocument();
	});

	it('names the selected day above the heading', async () => {
		await render(TodayView);
		expect(document.body.textContent).toContain(weekdayLong(todayISO()));
	});

	describe('card titles', () => {
		it('titles the Energy card', async () => {
			await render(TodayView);
			await expect
				.element(page.getByRole('heading', { name: 'Energy', level: 2 }))
				.toBeInTheDocument();
		});

		it('titles the Energy card the same way on the GLP-1 layout', async () => {
			onboard(true);
			await render(TodayView);
			await expect
				.element(page.getByRole('heading', { name: 'Energy', level: 2 }))
				.toBeInTheDocument();
		});

		it('titles the Weight card', async () => {
			await render(TodayView);
			await expect
				.element(page.getByRole('heading', { name: 'Weight', level: 2 }))
				.toBeInTheDocument();
		});

		it('titles the Training card', async () => {
			await render(TodayView);
			await expect
				.element(page.getByRole('heading', { name: 'Training', level: 2 }))
				.toBeInTheDocument();
		});
	});

	describe('Energy card log action', () => {
		it('opens the log sheet on the default tab from the Energy card', async () => {
			await render(TodayView);
			await page.getByRole('button', { name: 'Log food' }).click();
			expect(logUi.open).toBe(true);
			expect(logUi.tab).toBe('search');
			expect(logUi.meal).toBe(null);
		});
	});

	describe('Weight card entry', () => {
		it('starts collapsed', async () => {
			await render(TodayView);
			await expect.element(page.getByLabelText('Weight in kilograms')).not.toBeInTheDocument();
		});

		it('expands to the weight-entry form from its Log weight button', async () => {
			await render(TodayView);
			await page.getByRole('button', { name: 'Log weight' }).click();
			await expect.element(page.getByLabelText('Weight in kilograms')).toBeInTheDocument();
			await expect
				.element(page.getByRole('button', { name: 'Today', exact: true }))
				.toBeInTheDocument();
			await expect.element(page.getByRole('button', { name: 'Close' })).toBeInTheDocument();
		});

		it('collapses again from its Close button', async () => {
			await render(TodayView);
			await page.getByRole('button', { name: 'Log weight' }).click();
			await page.getByRole('button', { name: 'Close' }).click();
			await expect.element(page.getByLabelText('Weight in kilograms')).not.toBeInTheDocument();
			await expect.element(page.getByRole('button', { name: 'Log weight' })).toBeInTheDocument();
		});

		it('records a submitted entry against today', async () => {
			await render(TodayView);
			await page.getByRole('button', { name: 'Log weight' }).click();
			await page.getByLabelText('Weight in kilograms').fill('81');
			await page.getByRole('button', { name: 'Today', exact: true }).click();
			expect(tend.profile?.weights.some((w) => w.kg === 81 && w.date === todayISO())).toBe(true);
			// The section may stay open after a successful entry.
			await expect.element(page.getByLabelText('Weight in kilograms')).toBeInTheDocument();
		});
	});

	describe('Training card link', () => {
		it('links to the exercise route', async () => {
			await render(TodayView);
			const link = page.getByRole('link', { name: 'Go to training' });
			await expect.element(link).toBeInTheDocument();
			expect(link.element().getAttribute('href')).toBe('/exercise');
		});
	});

	describe('card action buttons', () => {
		// #today-card-actions polish: the round corner action sat too close to
		// the content above it, so it steps down one size (`icon-round-sm`
		// rather than `icon-round`) while the 44px tap target is preserved
		// through padding rather than the button's own box shrinking.
		it('sizes the Energy, Weight and Training card actions down a step', async () => {
			await render(TodayView);
			const actions = [
				page.getByRole('button', { name: 'Log food' }),
				page.getByRole('button', { name: 'Log weight' }),
				page.getByRole('link', { name: 'Go to training' })
			];
			for (const action of actions) {
				await expect.element(action).toBeInTheDocument();
				expect(action.element().className).toContain(BUTTON_SIZES['icon-round-sm']);
			}
		});
	});

	describe('training tile and week strip', () => {
		it('states plainly that a new account has no training logged or planned', async () => {
			await render(TodayView);
			await expect
				.element(page.getByText('No training logged or planned this week.'))
				.toBeInTheDocument();
		});

		it('renders how many sessions happened against what was planned', async () => {
			tend.state.workouts.push(finishedWorkout());
			await render(TodayView);
			await expect
				.element(page.getByText('1 session this week. Nothing was planned.'))
				.toBeInTheDocument();
		});

		it('gives the training tile an accessible name that says what it measures', async () => {
			await render(TodayView);
			await expect
				.element(page.getByRole('group', { name: "This week's training" }))
				.toBeInTheDocument();
		});

		it('marks each week-strip day with what was logged that day', async () => {
			const yesterday = addDaysISO(todayISO(), -1);
			const twoDaysAgo = addDaysISO(todayISO(), -2);
			logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast', date: todayISO() });
			tend.addWeight(80, yesterday);
			tend.state.workouts.push(finishedWorkout(twoDaysAgo));
			await render(TodayView);
			await expect.element(page.getByRole('button', { name: /food logged/ })).toBeInTheDocument();
			await expect.element(page.getByRole('button', { name: /weight logged/ })).toBeInTheDocument();
			await expect
				.element(page.getByRole('button', { name: /exercise logged/ }))
				.toBeInTheDocument();
		});

		it('keeps the day log within the first phone-sized viewport', async () => {
			logFood({ foodId: 'egg-large', servings: 2, meal: 'breakfast' });
			await page.viewport(390, 844);
			await render(TodayView);
			const heading = page.getByRole('heading', { name: 'breakfast', level: 2 });
			const box = heading.element().getBoundingClientRect();
			expect(box.top).toBeLessThan(844);
		});
	});
});
