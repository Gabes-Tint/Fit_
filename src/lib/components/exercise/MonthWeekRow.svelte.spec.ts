import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { CalendarWeek } from '$lib/domain/training-plan';
import type { PlannedWeek } from '$lib/domain/types';
import { routine } from '$lib/testing/fixtures';
import MonthWeekRow from './MonthWeekRow.svelte';
import { planOptions } from './plan-options';

const OPTIONS = planOptions([routine('push', 'Chest & Shoulders')]);

const WEEK: CalendarWeek = {
	week: 34,
	month: 7,
	startISO: '2026-08-17',
	endISO: '2026-08-23',
	label: 'Aug 17–23'
};

const PLANNED: PlannedWeek[] = [{ year: 2026, week: 34, routineId: 'push' }];

function props(plan: PlannedWeek[], onpick = vi.fn()) {
	return { week: WEEK, options: OPTIONS, plan, year: 2026, onpick };
}

describe('MonthWeekRow', () => {
	it('names the week and the days it covers', async () => {
		await render(MonthWeekRow, { props: props([]) });
		await expect.element(page.getByText('Week 34')).toBeInTheDocument();
		await expect.element(page.getByText('Aug 17–23')).toBeInTheDocument();
	});

	it('says a week is unassigned until it is planned', async () => {
		await render(MonthWeekRow, { props: props([]) });
		await expect.element(page.getByText('Unassigned')).toBeInTheDocument();
	});

	it('names the routine the week was planned as', async () => {
		await render(MonthWeekRow, { props: props(PLANNED) });
		await expect.element(page.getByText('Chest & Shoulders')).toBeInTheDocument();
	});

	it('marks only the days the routine trains on', async () => {
		await render(MonthWeekRow, { props: props(PLANNED) });
		// Three training days, plus the chip that names the routine.
		expect(document.querySelectorAll('.bg-primary')).toHaveLength(4);
	});

	it('leaves every day quiet while the week is unassigned', async () => {
		await render(MonthWeekRow, { props: props([]) });
		expect(document.querySelectorAll('.bg-primary')).toHaveLength(0);
	});

	it('applies the brush when the row is tapped', async () => {
		const onpick = vi.fn();
		await render(MonthWeekRow, { props: props([], onpick) });
		await page.getByRole('button', { name: /Week 34/ }).click();
		expect(onpick).toHaveBeenCalledOnce();
	});
});
