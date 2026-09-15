import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Workout } from '$lib/domain/types';
import ResumeWorkoutBanner from './ResumeWorkoutBanner.svelte';

/** A session in progress with `done` of its three sets ticked. */
function workout(done: number, startedAt = 0): Workout {
	return {
		id: 'w-1',
		routineId: 'push',
		routineName: 'Chest & Shoulders',
		date: '2026-01-05',
		startedAt,
		finishedAt: null,
		exerciseIndex: 0,
		note: '',
		exercises: [
			{
				name: 'Bench Press',
				group: 'Chest',
				sets: Array.from({ length: 3 }, (_, i) => ({ reps: 8, load: 45, done: i < done }))
			}
		]
	};
}

describe('ResumeWorkoutBanner', () => {
	it('stays out of the way when nothing is running', async () => {
		await render(ResumeWorkoutBanner, { props: { workout: null } });
		expect(page.getByRole('link').elements()).toHaveLength(0);
	});

	it('stays out of the way when the session logged nothing', async () => {
		await render(ResumeWorkoutBanner, { props: { workout: workout(0) } });
		expect(page.getByRole('link').elements()).toHaveLength(0);
	});

	it('names the routine that is still open', async () => {
		await render(ResumeWorkoutBanner, { props: { workout: workout(2) } });
		await expect.element(page.getByText('Chest & Shoulders in progress')).toBeInTheDocument();
	});

	it('counts what has been logged so far', async () => {
		await render(ResumeWorkoutBanner, { props: { workout: workout(2) } });
		await expect.element(page.getByText('2 sets logged')).toBeInTheDocument();
	});

	it('counts a single set in the singular', async () => {
		await render(ResumeWorkoutBanner, { props: { workout: workout(1) } });
		await expect.element(page.getByText('1 set logged')).toBeInTheDocument();
	});

	it('leads back to the session', async () => {
		await render(ResumeWorkoutBanner, { props: { workout: workout(1) } });
		await expect.element(page.getByRole('link')).toHaveAttribute('href', '/exercise/session');
	});

	it('says how long ago the session was left', async () => {
		// Half a second past the whole second, so the reading cannot flip while it is taken.
		await render(ResumeWorkoutBanner, { props: { workout: workout(2, Date.now() - 3_725_500) } });
		await expect
			.element(page.getByText('2 sets logged · 1:02:05 ago', { exact: true }))
			.toBeInTheDocument();
	});

	it('reads a session that has only just been left in seconds', async () => {
		await render(ResumeWorkoutBanner, { props: { workout: workout(1, Date.now() - 8_500) } });
		await expect
			.element(page.getByText('1 set logged · 0:00:08 ago', { exact: true }))
			.toBeInTheDocument();
	});

	it('keeps the reading coarse rather than running a stopwatch', async () => {
		const timer = vi.spyOn(globalThis, 'setInterval');
		await render(ResumeWorkoutBanner, { props: { workout: workout(2) } });
		expect(timer.mock.calls.map((call) => call[1])).toEqual([10_000]);
		timer.mockRestore();
	});

	it('starts no clock for a banner that is not shown', async () => {
		const timer = vi.spyOn(globalThis, 'setInterval');
		await render(ResumeWorkoutBanner, { props: { workout: workout(0) } });
		expect(timer).not.toHaveBeenCalled();
		timer.mockRestore();
	});

	it('takes its clock down with it', async () => {
		const stop = vi.spyOn(globalThis, 'clearInterval');
		const banner = await render(ResumeWorkoutBanner, { props: { workout: workout(2) } });
		expect(stop).not.toHaveBeenCalled();
		await banner.unmount();
		expect(stop).toHaveBeenCalledTimes(1);
		stop.mockRestore();
	});

	it('follows a session that moved on while the banner was on screen', async () => {
		const props: { workout: Workout | null } = $state({ workout: workout(1) });
		await render(ResumeWorkoutBanner, { props });
		props.workout = { ...workout(3), routineName: 'Legs' };
		await expect.element(page.getByText('Legs in progress')).toBeInTheDocument();
		await expect.element(page.getByText('3 sets logged')).toBeInTheDocument();
	});
});
