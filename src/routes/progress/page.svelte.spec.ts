import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { emptyProfile } from '$lib/domain/profile';
import { lbToKg } from '$lib/domain/units';
import { addDaysISO, todayISO } from '$lib/domain/utils';
import { tend } from '$lib/state/tend.svelte';
import ProgressPage from './+page.svelte';

/** Named `page.svelte.spec.ts`, not `+page.svelte.spec.ts`: SvelteKit reserves `+`. */

function onboard() {
	tend.resetAll();
	tend.completeOnboarding({
		profile: {
			...emptyProfile({ name: 'Alex' }),
			weights: [{ id: 'w1', date: '2026-06-01', kg: 74.3 }]
		},
		household: false,
		useSample: false
	});
}

beforeEach(() => {
	localStorage.clear();
	onboard();
});

describe('the weight preference on Progress', () => {
	it('reads metric by default', async () => {
		await render(ProgressPage);
		await expect.element(page.getByText('74.3')).toBeInTheDocument();
	});

	it('reads the same stored weight in pounds once the preference is imperial, unrounded to display precision', async () => {
		tend.setUnits('imperial');
		await render(ProgressPage);
		// 74.3 kg -> 163.8 lb, not the stored kg reading.
		await expect.element(page.getByText('163.8')).toBeInTheDocument();
		expect(tend.profile?.weights[0]?.kg).toBe(74.3);
	});

	it('stores a weight typed in pounds as the exact equivalent kilograms', async () => {
		tend.setUnits('imperial');
		await render(ProgressPage);
		await page.getByLabelText('Weight in pounds').fill('160');
		await page.getByRole('button', { name: 'Today' }).click();
		const latest = tend.profile?.weights.at(-1);
		expect(latest?.kg).toBe(lbToKg(160));
	});
});

describe('saving for 2 days ago, yesterday or today on Progress', () => {
	it('stores the reading dated today when "Today" is clicked', async () => {
		await render(ProgressPage);
		await page.getByLabelText('Weight in kilograms').fill('80');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		const latest = tend.profile?.weights.find((w) => w.date === todayISO());
		expect(latest?.kg).toBe(80);
	});

	it('stores the reading dated yesterday when "Yesterday" is clicked', async () => {
		await render(ProgressPage);
		await page.getByLabelText('Weight in kilograms').fill('81');
		await page.getByRole('button', { name: 'Yesterday' }).click();
		const yesterday = addDaysISO(todayISO(), -1);
		const entry = tend.profile?.weights.find((w) => w.date === yesterday);
		expect(entry?.kg).toBe(81);
	});

	it('stores the reading dated two days ago when "2 days ago" is clicked', async () => {
		await render(ProgressPage);
		await page.getByLabelText('Weight in kilograms').fill('79');
		await page.getByRole('button', { name: '2 days ago' }).click();
		const twoDaysAgo = addDaysISO(todayISO(), -2);
		const entry = tend.profile?.weights.find((w) => w.date === twoDaysAgo);
		expect(entry?.kg).toBe(79);
	});

	it('is a no-op for all three buttons when the field is blank', async () => {
		await render(ProgressPage);
		const before = JSON.stringify(tend.profile?.weights);
		await page.getByRole('button', { name: '2 days ago' }).click();
		await page.getByRole('button', { name: 'Yesterday' }).click();
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		expect(JSON.stringify(tend.profile?.weights)).toBe(before);
	});

	it('keeps one reading when saving twice for the same day', async () => {
		await render(ProgressPage);
		await page.getByLabelText('Weight in kilograms').fill('83');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		await page.getByLabelText('Weight in kilograms').fill('84');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		const todaysReadings = tend.profile?.weights.filter((w) => w.date === todayISO());
		expect(todaysReadings?.length).toBe(1);
		expect(todaysReadings?.[0]?.kg).toBe(84);
	});
});
