import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { routine } from '$lib/testing/fixtures';
import { optionsOn, planOptions } from './plan-options';
import PlanDayRow from './PlanDayRow.svelte';

const OPTIONS = planOptions([routine('lift', 'Full body'), routine('run', 'Easy run')]);

function props(routineIds: string[] = [], isToday = false, onpick = vi.fn()) {
	return { label: 'Mon 7', sessions: optionsOn(OPTIONS, routineIds), isToday, onpick };
}

describe('PlanDayRow', () => {
	it('names the day', async () => {
		await render(PlanDayRow, { props: props() });
		await expect.element(page.getByText('Mon 7')).toBeInTheDocument();
	});

	it('calls a day with nothing on it a rest day', async () => {
		await render(PlanDayRow, { props: props() });
		await expect.element(page.getByText('Rest')).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Mon 7, nothing planned' }))
			.toBeInTheDocument();
	});

	it('shows the routines on the day in the order they are trained', async () => {
		await render(PlanDayRow, { props: props(['run', 'lift']) });
		const names = [...document.querySelectorAll('span.rounded-full')].map((s) => s.textContent);
		expect(names.map((name) => name?.trim())).toEqual(['Easy run', 'Full body']);
	});

	it('names both routines to a screen reader, in that same order', async () => {
		await render(PlanDayRow, { props: props(['run', 'lift']) });
		await expect
			.element(page.getByRole('button', { name: 'Mon 7, Easy run, then Full body' }))
			.toBeInTheDocument();
	});

	it('drops the rest label as soon as the day holds something', async () => {
		await render(PlanDayRow, { props: props(['lift']) });
		expect(page.getByText('Rest').elements()).toHaveLength(0);
	});

	it('opens the day when the row is tapped', async () => {
		const onpick = vi.fn();
		await render(PlanDayRow, { props: props(['lift'], false, onpick) });
		await page.getByRole('button').click();
		expect(onpick).toHaveBeenCalledTimes(1);
	});

	it('sets today apart from the rest of the week', async () => {
		await render(PlanDayRow, { props: props([], true) });
		expect(document.querySelectorAll('.font-semibold')).toHaveLength(1);
	});

	it('leaves an ordinary day unweighted', async () => {
		await render(PlanDayRow, { props: props() });
		expect(document.querySelectorAll('.font-semibold')).toHaveLength(0);
	});
});
