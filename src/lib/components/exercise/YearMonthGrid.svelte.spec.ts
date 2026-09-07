import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { calendarWeeks } from '$lib/domain/training-plan';
import type { PlannedWeek } from '$lib/domain/types';
import { routine } from '$lib/testing/fixtures';
import { planOptions } from './plan-options';
import YearMonthGrid from './YearMonthGrid.svelte';

const OPTIONS = planOptions([routine('push', 'Chest & Shoulders')]);
const WEEKS = calendarWeeks(2026);
const PLAN: PlannedWeek[] = [{ year: 2026, week: 1, routineId: 'push' }];

function props(plan: PlannedWeek[] = [], onpick = vi.fn()) {
	return { weeks: WEEKS, options: OPTIONS, plan, year: 2026, onpick };
}

describe('YearMonthGrid', () => {
	it('draws every week of the year', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect.element(page.getByRole('button', { name: /Week 52/ })).toBeInTheDocument();
		expect(document.querySelectorAll('button')).toHaveLength(WEEKS.length);
	});

	it('names each month', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect.element(page.getByText('Jan')).toBeInTheDocument();
		await expect.element(page.getByText('Dec')).toBeInTheDocument();
	});

	it('explains the colors with a legend', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect.element(page.getByText('Rest week')).toBeInTheDocument();
	});

	it('calls an unplanned week unassigned', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect
			.element(page.getByRole('button', { name: 'Week 1, unassigned' }))
			.toBeInTheDocument();
	});

	it('names the routine a planned week carries', async () => {
		await render(YearMonthGrid, { props: props(PLAN) });
		await expect
			.element(page.getByRole('button', { name: 'Week 1, Chest & Shoulders' }))
			.toBeInTheDocument();
	});

	it('reports the week that was tapped', async () => {
		const onpick = vi.fn();
		await render(YearMonthGrid, { props: props([], onpick) });
		await page.getByRole('button', { name: 'Week 1, unassigned' }).click();
		expect(onpick).toHaveBeenCalledWith(WEEKS[0]);
	});
});
