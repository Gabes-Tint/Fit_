import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { calendarWeeks } from '$lib/domain/training-plan';
import type { PlannedDay } from '$lib/domain/types';
import { routine } from '$lib/testing/fixtures';
import { planOptions } from './plan-options';
import YearMonthGrid from './YearMonthGrid.svelte';

const OPTIONS = planOptions([routine('push', 'Chest & Shoulders')]);
const WEEKS = calendarWeeks(2026);
/** Week 1 of 2026 opens on Monday 5 January; two of its days are planned. */
const PLAN: PlannedDay[] = [
	{ date: '2026-01-05', routineIds: ['push'] },
	{ date: '2026-01-08', routineIds: ['push'] }
];

function props(plan: PlannedDay[] = []) {
	return { weeks: WEEKS, options: OPTIONS, plan };
}

describe('YearMonthGrid', () => {
	it('draws every week of the year', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect.element(page.getByRole('link', { name: /Week 52/ })).toBeInTheDocument();
		expect(document.querySelectorAll('a')).toHaveLength(WEEKS.length);
	});

	it('names each month', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect.element(page.getByText('Jan')).toBeInTheDocument();
		await expect.element(page.getByText('Dec')).toBeInTheDocument();
	});

	it('explains the colors with a legend of the rotation', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect.element(page.getByText('Chest & Shoulders')).toBeInTheDocument();
	});

	it('says a week nobody planned has nothing on it', async () => {
		await render(YearMonthGrid, { props: props() });
		await expect
			.element(page.getByRole('link', { name: 'Week 1, nothing planned' }))
			.toBeInTheDocument();
	});

	it('counts the days a planned week actually holds', async () => {
		await render(YearMonthGrid, { props: props(PLAN) });
		await expect
			.element(page.getByRole('link', { name: 'Week 1, 2 days planned' }))
			.toBeInTheDocument();
	});

	it('opens the week it names in the week view', async () => {
		await render(YearMonthGrid, { props: props(PLAN) });
		const week = page.getByRole('link', { name: 'Week 1, 2 days planned' });
		await expect.element(week).toHaveAttribute('href', '/exercise/plan?from=2026-01-05');
	});
});
