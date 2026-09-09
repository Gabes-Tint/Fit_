import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { emptyProfile } from '$lib/domain/profile';
import { addDaysISO, todayISO } from '$lib/domain/utils';
import { tend } from '$lib/state/tend.svelte';
import WeightEntry from './WeightEntry.svelte';

function onboard() {
	tend.resetAll();
	tend.completeOnboarding({
		profile: emptyProfile({ name: 'Alex' }),
		household: false,
		useSample: false
	});
}

beforeEach(() => {
	localStorage.clear();
	onboard();
});

describe('WeightEntry', () => {
	it('names the field in the unit it was given', async () => {
		await render(WeightEntry, { props: { units: 'metric' } });
		await expect.element(page.getByLabelText('Weight in kilograms')).toBeInTheDocument();
	});

	// Reactive to a live unit switch, not just to whatever it mounted with: `units`
	// comes from `tend.state.units`, a store the You page can change while this
	// component stays mounted elsewhere.
	it('relabels the field when its units prop changes after mount', async () => {
		const { rerender } = await render(WeightEntry, { props: { units: 'metric' } });
		await expect.element(page.getByLabelText('Weight in kilograms')).toBeInTheDocument();
		await rerender({ units: 'imperial' });
		await expect.element(page.getByLabelText('Weight in pounds')).toBeInTheDocument();
	});

	it('does nothing for a blank field', async () => {
		await render(WeightEntry, { props: { units: 'metric' } });
		const before = JSON.stringify(tend.profile?.weights);
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		expect(JSON.stringify(tend.profile?.weights)).toBe(before);
	});

	it('does nothing for a zero or negative entry', async () => {
		await render(WeightEntry, { props: { units: 'metric' } });
		const before = JSON.stringify(tend.profile?.weights);
		await page.getByLabelText('Weight in kilograms').fill('0');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		await page.getByLabelText('Weight in kilograms').fill('-5');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		expect(JSON.stringify(tend.profile?.weights)).toBe(before);
	});

	it('records a valid entry against today', async () => {
		await render(WeightEntry, { props: { units: 'metric' } });
		await page.getByLabelText('Weight in kilograms').fill('80');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		const entry = tend.profile?.weights.find((w) => w.date === todayISO());
		expect(entry?.kg).toBe(80);
	});

	it('dates the entry two days back from "2 days ago"', async () => {
		await render(WeightEntry, { props: { units: 'metric' } });
		await page.getByLabelText('Weight in kilograms').fill('79');
		await page.getByRole('button', { name: '2 days ago' }).click();
		const twoDaysAgo = addDaysISO(todayISO(), -2);
		const entry = tend.profile?.weights.find((w) => w.date === twoDaysAgo);
		expect(entry?.kg).toBe(79);
	});

	it('dates the entry one day back from "Yesterday"', async () => {
		await render(WeightEntry, { props: { units: 'metric' } });
		await page.getByLabelText('Weight in kilograms').fill('81');
		await page.getByRole('button', { name: 'Yesterday' }).click();
		const yesterday = addDaysISO(todayISO(), -1);
		const entry = tend.profile?.weights.find((w) => w.date === yesterday);
		expect(entry?.kg).toBe(81);
	});

	it('clears the field after a successful save', async () => {
		await render(WeightEntry, { props: { units: 'metric' } });
		await page.getByLabelText('Weight in kilograms').fill('80');
		await page.getByRole('button', { name: 'Today', exact: true }).click();
		await expect.element(page.getByLabelText('Weight in kilograms')).toHaveValue('');
	});
});
