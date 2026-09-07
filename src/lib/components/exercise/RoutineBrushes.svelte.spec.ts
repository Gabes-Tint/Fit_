import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { REST_WEEK } from '$lib/domain/types';
import { routine } from '$lib/testing/fixtures';
import { planOptions } from './plan-options';
import RoutineBrushes from './RoutineBrushes.svelte';

const ROUTINES = [routine('push', 'Chest & Shoulders'), routine('legs', 'Legs', 2)];

describe('RoutineBrushes', () => {
	it('offers a pill per routine and one for rest', async () => {
		await render(RoutineBrushes, {
			props: { options: planOptions(ROUTINES), selected: 'push', onpick: vi.fn() }
		});
		await expect.element(page.getByRole('button', { name: 'Legs' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Rest week' })).toBeInTheDocument();
	});

	it('marks the selected brush as pressed', async () => {
		await render(RoutineBrushes, {
			props: { options: planOptions(ROUTINES), selected: 'push', onpick: vi.fn() }
		});
		await expect
			.element(page.getByRole('button', { name: 'Chest & Shoulders' }))
			.toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(page.getByRole('button', { name: 'Legs' }))
			.toHaveAttribute('aria-pressed', 'false');
	});

	it('reports the brush that was tapped', async () => {
		const onpick = vi.fn();
		await render(RoutineBrushes, {
			props: { options: planOptions(ROUTINES), selected: 'push', onpick }
		});
		await page.getByRole('button', { name: 'Rest week' }).click();
		expect(onpick).toHaveBeenCalledWith(REST_WEEK);
	});
});
