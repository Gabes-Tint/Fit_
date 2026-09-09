import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { computeTargets } from '$lib/domain/tdee';
import { logFromFood } from '$lib/domain/log-entry';
import { emptyProfile } from '$lib/domain/profile';
import { heightFromFeetInches, heightToFeetInches } from '$lib/domain/units';
import { todayISO } from '$lib/domain/utils';
import { tend } from '$lib/state/tend.svelte';
import YouPage from './+page.svelte';

/** Named `page.svelte.spec.ts`, not `+page.svelte.spec.ts`: SvelteKit reserves `+`. */

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

describe('the Preferences section', () => {
	it('shows metric pressed by default', async () => {
		await render(YouPage);
		await expect
			.element(page.getByRole('button', { name: 'Metric' }))
			.toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(page.getByRole('button', { name: 'Imperial' }))
			.toHaveAttribute('aria-pressed', 'false');
	});

	it('switches the units preference immediately, no reload', async () => {
		await render(YouPage);
		await page.getByRole('button', { name: 'Imperial' }).click();
		expect(tend.state.units).toBe('imperial');
		await expect
			.element(page.getByRole('button', { name: 'Imperial' }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('keeps the load unit control separate from the units preference', async () => {
		await render(YouPage);
		await page.getByRole('button', { name: 'Imperial' }).click();
		expect(tend.state.loadUnit).toBe('kg');
	});

	it('steps the rest length rather than taking a typed value directly', async () => {
		await render(YouPage);
		await page.getByRole('button', { name: 'Increase rest between sets' }).click();
		expect(tend.state.restSeconds).toBe(105);
	});
});

describe('the Height field', () => {
	it('shows the onboarded height in centimeters under the metric preference', async () => {
		await render(YouPage);
		await expect.element(page.getByLabelText('Height in centimeters')).toHaveValue('168');
	});

	it('shows a visible cm unit label under the metric preference, not ft or in', async () => {
		await render(YouPage);
		await expect.element(page.getByText('cm', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('ft', { exact: true })).not.toBeInTheDocument();
		await expect.element(page.getByText('in', { exact: true })).not.toBeInTheDocument();
	});

	it('shows visible ft and in unit labels under the imperial preference, not cm', async () => {
		tend.state.units = 'imperial';
		await render(YouPage);
		await expect.element(page.getByText('ft', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('in', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('cm', { exact: true })).not.toBeInTheDocument();
	});

	it('saves an edited height onto the active profile', async () => {
		await render(YouPage);
		await page.getByLabelText('Height in centimeters').fill('180');
		await page.getByRole('button', { name: 'Save height' }).click();
		expect(tend.profile?.heightCm).toBe(180);
	});

	it('does not save a blank height', async () => {
		await render(YouPage);
		await page.getByLabelText('Height in centimeters').fill('');
		await page.getByRole('button', { name: 'Save height' }).click();
		expect(tend.profile?.heightCm).toBe(168);
	});

	it('saves the exact canonical cm for typed feet and inches, not a rounded display value', async () => {
		tend.state.units = 'imperial';
		await render(YouPage);
		await page.getByLabelText('Height, feet').fill('5');
		await page.getByLabelText('Height, inches').fill('9');
		await page.getByRole('button', { name: 'Save height' }).click();
		expect(tend.profile?.heightCm).toBe(heightFromFeetInches(5, 9));
	});

	it('leaves a fractional stored cm untouched when the metric form is submitted unedited', async () => {
		// 175.26 cm displays rounded to 175 in the metric field. Submitting
		// without editing must not truncate the stored value to that rounded
		// display — the same rounding-leaks-into-storage bug PR #73 caught for
		// weight, in reverse (display rounds, save must not adopt the rounding).
		tend.patchActive((p) => ({ ...p, heightCm: 175.26 }));
		await render(YouPage);
		await expect.element(page.getByLabelText('Height in centimeters')).toHaveValue('175');
		await page.getByRole('button', { name: 'Save height' }).click();
		expect(tend.profile?.heightCm).toBe(175.26);
	});

	it('leaves a stored cm untouched when the imperial form is submitted unedited', async () => {
		// 180.5 cm is not an exact number of inches: its ft/in display (5′11″)
		// rounds to the nearest inch, and heightFromFeetInches(5, 9) reads back
		// as 180.34 cm — not 180.5. Submitting the imperial form untouched must
		// not re-derive and overwrite the exact stored cm from that rounded
		// ft/in reading.
		const stored = 180.5;
		tend.patchActive((p) => ({ ...p, heightCm: stored }));
		tend.state.units = 'imperial';
		await render(YouPage);
		const { feet, inches } = heightToFeetInches(stored);
		await expect.element(page.getByLabelText('Height, feet')).toHaveValue(String(feet));
		await expect.element(page.getByLabelText('Height, inches')).toHaveValue(String(inches));
		await page.getByRole('button', { name: 'Save height' }).click();
		expect(tend.profile?.heightCm).toBe(stored);
	});

	it('round-trips the stored height through imperial and back with no drift', async () => {
		// 175 cm is not an exact number of inches: reading it as feet + inches
		// rounds to the nearest inch for display. Only entering a new value
		// (not merely switching the units toggle) may change the stored cm.
		tend.patchActive((p) => ({ ...p, heightCm: 175 }));
		await render(YouPage);
		await expect.element(page.getByLabelText('Height in centimeters')).toHaveValue('175');

		await page.getByRole('button', { name: 'Imperial' }).click();
		const { feet, inches } = heightToFeetInches(175);
		await expect.element(page.getByLabelText('Height, feet')).toHaveValue(String(feet));
		await expect.element(page.getByLabelText('Height, inches')).toHaveValue(String(inches));

		await page.getByRole('button', { name: 'Metric' }).click();
		// Still exactly 175 cm — the imperial display never wrote its rounded reading back.
		await expect.element(page.getByLabelText('Height in centimeters')).toHaveValue('175');
		expect(tend.profile?.heightCm).toBe(175);
	});

	/**
	 * #237. The height fields are not uncontrolled, whatever the form looks
	 * like: `Input` binds its own `value`, so a `value` prop that changes puts
	 * the stored reading back over whatever is half-typed. `heightToFeetInches`
	 * hands back a fresh object, so reading `.feet`/`.inches` off it made every
	 * unrelated profile write — a weight, a name, a document arriving from
	 * another device — look to the two fields like a new height. In CI that
	 * landed between the two `fill`s and the save, and the inches field went
	 * back to the onboarded 6 while the feet field, unchanged at 5, hid it.
	 */
	it('keeps both typed height fields through an unrelated profile write', async () => {
		tend.state.units = 'imperial';
		await render(YouPage);
		await page.getByLabelText('Height, feet').fill('6');
		await page.getByLabelText('Height, inches').fill('9');

		// Anything at all that rewrites the active profile; the height is not touched.
		tend.patchActive((p) => ({ ...p, name: 'Jordan' }));

		await expect.element(page.getByLabelText('Height, feet')).toHaveValue('6');
		await expect.element(page.getByLabelText('Height, inches')).toHaveValue('9');
		await page.getByRole('button', { name: 'Save height' }).click();
		expect(tend.profile?.heightCm).toBe(heightFromFeetInches(6, 9));
	});

	it('recomposes both height fields when the stored height really does change', async () => {
		// The other half of the same rule: holding still for an unrelated write
		// must not turn into ignoring a height that genuinely moved underneath
		// the form — a second device editing it, say.
		tend.state.units = 'imperial';
		await render(YouPage);
		await expect.element(page.getByLabelText('Height, feet')).toHaveValue('5');
		await expect.element(page.getByLabelText('Height, inches')).toHaveValue('6');

		tend.patchActive((p) => ({ ...p, heightCm: heightFromFeetInches(6, 2) }));

		await expect.element(page.getByLabelText('Height, feet')).toHaveValue('6');
		await expect.element(page.getByLabelText('Height, inches')).toHaveValue('2');
	});
});

describe('the energy target field', () => {
	/** #237 again: `computeTargets` allocates a fresh object, same as the height reading. */
	it('keeps a typed energy target through an unrelated profile write', async () => {
		await render(YouPage);
		await page.getByLabelText('Energy, kcal').fill('2400');

		tend.patchActive((p) => ({ ...p, name: 'Jordan' }));

		await expect.element(page.getByLabelText('Energy, kcal')).toHaveValue('2400');
	});
});

describe('the Privacy section', () => {
	it('does not claim logs stay only on the device now that they sync', async () => {
		// Regression: this used to say "Nothing is sent anywhere — there is no
		// server yet", which became false once /api/state started syncing logs.
		await render(YouPage);
		const privacy = document.body.querySelector('ul');
		const text = privacy?.textContent ?? '';
		expect(text).not.toMatch(/nothing is sent anywhere/i);
		expect(text).not.toMatch(/no server/i);
	});

	it('says the logs sync to the server for the account', async () => {
		await render(YouPage);
		await expect.element(page.getByText(/sync to the server/i)).toBeInTheDocument();
	});
});

describe('the Energy target', () => {
	it('shows the computed target in an editable field', async () => {
		await render(YouPage);
		const automatic = computeTargets(emptyProfile({ name: 'Alex' }));
		await expect.element(page.getByLabelText('Energy, kcal')).toHaveValue(String(automatic.kcal));
	});

	it('writes calorieOverride and the displayed target follows it', async () => {
		await render(YouPage);
		await page.getByLabelText('Energy, kcal').fill('1800');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		expect(tend.profile?.calorieOverride).toBe(1800);
		await expect.element(page.getByLabelText('Energy, kcal')).toHaveValue('1800');
		await expect.element(page.getByText(/steering these by hand/)).toBeInTheDocument();
	});

	it('clearing returns to the computed value and the blurb changes back', async () => {
		tend.patchActive((p) => ({ ...p, calorieOverride: 1800 }));
		await render(YouPage);
		await expect.element(page.getByText(/steering these by hand/)).toBeInTheDocument();

		await page.getByRole('button', { name: 'Use automatic' }).click();
		expect(tend.profile?.calorieOverride).toBeNull();
		const automatic = computeTargets(emptyProfile({ name: 'Alex' }));
		await expect.element(page.getByLabelText('Energy, kcal')).toHaveValue(String(automatic.kcal));
		await expect.element(page.getByText(/steering these by hand/)).not.toBeInTheDocument();
	});

	it('rejects a value under 1200', async () => {
		await render(YouPage);
		await page.getByLabelText('Energy, kcal').fill('1000');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		expect(tend.profile?.calorieOverride).toBeNull();
		await expect.element(page.getByText(/at least 1200 kcal/)).toBeInTheDocument();
	});
});

describe('redoing setup', () => {
	it('opens the setup questions when the link is clicked', async () => {
		await render(YouPage);
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect.element(page.getByText('A few quiet facts.')).toBeInTheDocument();
	});

	it('starts the fields empty rather than pre-filled with the current profile', async () => {
		tend.patchActive((p) => ({ ...p, name: 'Jordan', age: 51, heightCm: 190 }));
		await render(YouPage);
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect.element(page.getByLabelText('Name')).not.toHaveValue('Jordan');
		await expect.element(page.getByLabelText('Age')).not.toHaveValue('51');
	});

	it('saving preserves the log, weight history and injections', async () => {
		const logItem = logFromFood({
			foodId: 'egg-large',
			servings: 2,
			meal: 'breakfast',
			date: todayISO(),
			source: 'manual'
		});
		tend.addLogItems([logItem]);
		tend.patchActive((p) => ({
			...p,
			weights: [...p.weights, { id: 'w-1', date: todayISO(), kg: 70 }]
		}));
		await render(YouPage);

		await page.getByRole('button', { name: 'Redo setup' }).click();
		await page.getByLabelText('Name').fill('Jordan');
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		expect(tend.profile?.name).toBe('Jordan');
		expect(tend.profile?.log).toHaveLength(1);
		expect(tend.profile?.log[0]?.id).toBe(logItem.id);
		expect(tend.profile?.weights).toHaveLength(1);
		expect(tend.profile?.weights[0]?.id).toBe('w-1');
	});

	it('cancelling leaves the profile untouched', async () => {
		await render(YouPage);
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect.element(page.getByRole('heading', { name: 'You' })).toBeInTheDocument();
		expect(tend.profile?.name).toBe('Alex');
	});
});
