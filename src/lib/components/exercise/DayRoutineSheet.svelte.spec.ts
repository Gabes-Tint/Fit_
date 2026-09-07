import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { routine } from '$lib/testing/fixtures';
import DayRoutineSheet from './DayRoutineSheet.svelte';
import { planOptions } from './plan-options';

const OPTIONS = planOptions([routine('lift', 'Full body'), routine('run', 'Easy run')]);
const DAY = { heading: 'Monday', when: '7 September 2026' };

function props(chosen: string[] = [], onpick = vi.fn()) {
	return { open: true, day: DAY, options: OPTIONS, chosen, onpick, onclose: () => {} };
}

describe('DayRoutineSheet', () => {
	it('names the day it is planning', async () => {
		await render(DayRoutineSheet, { props: props() });
		await expect.element(page.getByText('Monday')).toBeInTheDocument();
		await expect.element(page.getByText('7 September 2026')).toBeInTheDocument();
	});

	it('offers every routine and nothing for rest, because rest is an empty day', async () => {
		await render(DayRoutineSheet, { props: props() });
		expect(page.getByRole('button', { name: /Full body/ }).elements()).toHaveLength(1);
		expect(page.getByRole('button', { name: /Easy run/ }).elements()).toHaveLength(1);
		expect(page.getByRole('button', { name: /Rest/ }).elements()).toHaveLength(0);
	});

	it('marks the routines already on the day', async () => {
		await render(DayRoutineSheet, { props: props(['run']) });
		await expect
			.element(page.getByRole('button', { name: /Easy run/ }))
			.toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(page.getByRole('button', { name: /Full body/ }))
			.toHaveAttribute('aria-pressed', 'false');
	});

	it('numbers each session by its place in the day', async () => {
		await render(DayRoutineSheet, { props: props(['run', 'lift']) });
		await expect.element(page.getByText('Session 1 of the day')).toBeInTheDocument();
		await expect.element(page.getByText('Session 2 of the day')).toBeInTheDocument();
	});

	it('says which routines are not on the day', async () => {
		await render(DayRoutineSheet, { props: props(['run']) });
		await expect.element(page.getByText('Not on this day')).toBeInTheDocument();
	});

	it('reports the routine that was tapped', async () => {
		const onpick = vi.fn();
		await render(DayRoutineSheet, { props: props([], onpick) });
		await page.getByRole('button', { name: /Easy run/ }).click();
		expect(onpick).toHaveBeenCalledWith('run');
	});

	it('says an empty day is the rest day rather than leaving it unexplained', async () => {
		await render(DayRoutineSheet, { props: props() });
		await expect.element(page.getByText(/what a rest day is/)).toBeInTheDocument();
	});

	it('says a day can hold more than one once it holds any', async () => {
		await render(DayRoutineSheet, { props: props(['lift']) });
		await expect.element(page.getByText(/A day can hold more than one/)).toBeInTheDocument();
	});

	it('draws nothing at all until a day is chosen', async () => {
		await render(DayRoutineSheet, { props: { ...props(), day: null } });
		expect(page.getByRole('dialog').elements()).toHaveLength(0);
	});
});
