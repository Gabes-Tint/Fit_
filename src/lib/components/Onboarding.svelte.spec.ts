import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { displayWeight, heightFromFeetInches, kgToLb, lbToKg } from '$lib/domain/units';
import { tend } from '$lib/state/tend.svelte';
import Onboarding from './Onboarding.svelte';

async function toStepTwo() {
	await render(Onboarding);
	await page.getByRole('button', { name: 'Continue' }).click();
}

async function toStepThree() {
	await toStepTwo();
	await page.getByRole('button', { name: 'Continue' }).click();
}

beforeEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
	tend.state.units = 'metric';
});

describe('Onboarding', () => {
	it('opens on the welcome step', async () => {
		await render(Onboarding);
		await expect.element(page.getByText('A quieter tracker')).toBeInTheDocument();
	});

	it('leads with the promise that a missed day is fine', async () => {
		await render(Onboarding);
		await expect.element(page.getByText('No red days.')).toBeInTheDocument();
	});

	it('moves on to the details step', async () => {
		await toStepTwo();
		await expect.element(page.getByText('A few quiet facts.')).toBeInTheDocument();
	});

	it('can go back from the details step', async () => {
		await toStepTwo();
		await page.getByRole('button', { name: 'Back' }).click();
		await expect.element(page.getByText('A quieter tracker')).toBeInTheDocument();
	});

	it('marks the chosen aim as selected', async () => {
		await toStepTwo();
		await page.getByRole('button', { name: /Maintain/ }).click();
		await expect
			.element(page.getByRole('button', { name: /Maintain/ }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('turns on GLP-1 mode when the GLP-1 aim is chosen', async () => {
		await toStepTwo();
		await page.getByRole('button', { name: /GLP-1/ }).first().click();
		await expect
			.element(page.getByRole('switch', { name: 'GLP-1 mode' }))
			.toHaveAttribute('data-state', 'checked');
	});

	it('toggles a dietary filter on', async () => {
		await toStepTwo();
		await page.getByRole('button', { name: 'Vegan' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Vegan' }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('offers both a sample and an empty start', async () => {
		await toStepThree();
		await expect
			.element(page.getByRole('button', { name: 'Open the sample journal' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Start empty' })).toBeInTheDocument();
	});

	it('completes onboarding with the sample journal', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		await toStepThree();
		await page.getByRole('button', { name: 'Open the sample journal' }).click();
		expect(complete).toHaveBeenCalledWith(expect.objectContaining({ useSample: true }));
	});

	it('completes onboarding empty', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		await toStepThree();
		await page.getByRole('button', { name: 'Start empty' }).click();
		expect(complete).toHaveBeenCalledWith(expect.objectContaining({ useSample: false }));
	});

	it('starts first-run answers from the emptyProfile defaults', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		await toStepTwo();
		await expect.element(page.getByLabelText('Age')).toHaveValue(32);
		await expect.element(page.getByLabelText('Height cm')).toHaveValue(168);
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		const profile = complete.mock.calls[0]?.[0].profile;
		expect(profile?.age).toBe(32);
		expect(profile?.restrictions).toEqual([]);
	});

	it('carries the entered name into the new profile', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		await render(Onboarding);
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByLabelText('Name').fill('Robin');
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		expect(complete.mock.calls[0]?.[0].profile.name).toBe('Robin');
	});

	it('falls back to a placeholder name when the field is cleared', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		await render(Onboarding);
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByLabelText('Name').fill('');
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		expect(complete.mock.calls[0]?.[0].profile.name).toBe('You');
	});

	it('records the entered weight as the first weigh-in', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		await render(Onboarding);
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByLabelText('Weight kg').fill('72');
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		expect(complete.mock.calls[0]?.[0].profile.weights[0]?.kg).toBe(72);
	});

	it('asks for height and weight in feet, inches and pounds under the imperial preference', async () => {
		tend.state.units = 'imperial';
		await toStepTwo();
		await expect.element(page.getByLabelText('Weight lb')).toBeInTheDocument();
		await expect.element(page.getByLabelText('Height, feet')).toBeInTheDocument();
		await expect.element(page.getByLabelText('Height, inches')).toBeInTheDocument();
	});

	it('stores the imperial reading as exact canonical kg and cm, not the rounded display value', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		tend.state.units = 'imperial';
		await toStepTwo();
		await page.getByLabelText('Weight lb').fill('160');
		await page.getByLabelText('Height, feet').fill('5');
		await page.getByLabelText('Height, inches').fill('9');
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		const profile = complete.mock.calls[0]?.[0].profile;
		// The exact conversion, not `round1`'s display-precision value (72.6): storing
		// the rounded figure would make a 160 lb entry read back as something else.
		expect(profile?.weights[0]?.kg).toBe(lbToKg(160));
		expect(profile?.heightCm).toBe(heightFromFeetInches(5, 9));
	});

	it('round-trips a typed imperial weight back to the exact same reading', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		tend.state.units = 'imperial';
		await toStepTwo();
		await page.getByLabelText('Weight lb').fill('160');
		await page.getByRole('button', { name: 'Continue' }).click();
		await page.getByRole('button', { name: 'Start empty' }).click();
		const storedKg = complete.mock.calls[0]?.[0].profile.weights[0]?.kg ?? 0;
		expect(displayWeight(storedKg, 'imperial')).toBe(160);
		expect(kgToLb(storedKg)).toBeCloseTo(160, 9);
	});

	it('renders no household profile switch', async () => {
		await toStepThree();
		await expect
			.element(page.getByRole('switch', { name: 'Add a household profile' }))
			.not.toBeInTheDocument();
	});

	it('always completes onboarding with household false', async () => {
		const complete = vi.spyOn(tend, 'completeOnboarding').mockImplementation(() => undefined);
		await toStepThree();
		await page.getByRole('button', { name: 'Start empty' }).click();
		expect(complete).toHaveBeenCalledWith(expect.objectContaining({ household: false }));
	});
});
