import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openEmptyJournal, signInThroughApi } from '../../tests/e2e-support';

/**
 * Height (#93): asked once in onboarding, then unreachable on any screen — a
 * mistyped height had no fix short of deleting the whole journal. These
 * tests drive the real `/you` screen rather than the domain functions
 * directly, so a UI-level regression (e.g. losing the edit, or a rounding
 * drift like the one PR #73 fixed for weight) is caught too.
 */

async function openYou(page: Page) {
	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('link', { name: 'You' }).click();
	await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();
}

test.describe('height on the You screen', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await openEmptyJournal(page);
	});

	test('shows the onboarded height and lets it be edited', async ({ page }) => {
		await openYou(page);
		const height = page.getByLabel('Height in centimeters');
		await expect(height).toHaveValue('168');
		await expect(page.getByText('cm', { exact: true })).toBeVisible();

		await height.fill('180');
		await page.getByRole('button', { name: 'Save height' }).click();

		await page.reload();
		await openYou(page);
		await expect(page.getByLabel('Height in centimeters')).toHaveValue('180');
	});

	test('reads and saves height in feet and inches under the imperial preference', async ({
		page
	}) => {
		await openYou(page);
		await page.getByRole('button', { name: 'Imperial' }).click();
		await expect(page.getByLabel('Height, feet')).toHaveValue('5');
		await expect(page.getByLabel('Height, inches')).toHaveValue('6');
		await expect(page.getByText('ft', { exact: true })).toBeVisible();
		await expect(page.getByText('in', { exact: true })).toBeVisible();

		await page.getByLabel('Height, feet').fill('5');
		await page.getByLabel('Height, inches').fill('9');
		await page.getByRole('button', { name: 'Save height' }).click();

		await page.reload();
		await openYou(page);
		await expect(page.getByLabel('Height, feet')).toHaveValue('5');
		await expect(page.getByLabel('Height, inches')).toHaveValue('9');
	});

	test('hides the household feature', async ({ page }) => {
		await openYou(page);
		await expect(page.getByRole('heading', { name: 'Household' })).toHaveCount(0);
	});
});

test.describe('Redo setup from the You page', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await openEmptyJournal(page);
		// Navigate to the You page
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('link', { name: 'You' }).click();
		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();
	});

	test('pre-fills form fields from the active profile when redo setup is clicked', async ({
		page
	}) => {
		// Edit the profile to have specific values
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		// Fill in a profile manually first to establish baseline
		await page.getByLabel('Name').fill('Jordan');
		await page.getByLabel('Age').fill('51');
		await page.getByLabel('Height cm').fill('190');
		await page.getByRole('button', { name: /^Lose/ }).click(); // Click the Lose button to set goal
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		// Wait for the profile to be saved and the modal to close
		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();

		// Now click Redo setup again to verify pre-filling
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		// Assert that the fields are pre-filled from the active profile
		await expect(page.getByLabel('Name')).toHaveValue('Jordan');
		await expect(page.getByLabel('Age')).toHaveValue('51');
		await expect(page.getByLabel('Height cm')).toHaveValue('190');

		// The Lose button matching the goal should be selected
		const loseButton = page.getByRole('button', { name: /^Lose/ });
		await expect(loseButton).toHaveAttribute('aria-pressed', 'true');
	});

	test('saves only changed fields while preserving other profile data', async ({ page }) => {
		// First, edit the profile with some initial values
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		await page.getByLabel('Name').fill('Jordan');
		await page.getByLabel('Age').fill('51');
		await page.getByLabel('Height cm').fill('190');
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();

		// Now redo setup again and change only the age
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		// Verify current values are pre-filled
		await expect(page.getByLabel('Name')).toHaveValue('Jordan');
		await expect(page.getByLabel('Age')).toHaveValue('51');
		await expect(page.getByLabel('Height cm')).toHaveValue('190');

		// Change only the age
		await page.getByLabel('Age').fill('52');
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();

		// Reopen the form to verify only age changed while name and height stayed the same
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		await expect(page.getByLabel('Name')).toHaveValue('Jordan');
		await expect(page.getByLabel('Age')).toHaveValue('52');
		await expect(page.getByLabel('Height cm')).toHaveValue('190');
	});

	test('canceling the form leaves the profile unchanged', async ({ page }) => {
		// First establish a profile with specific values
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		await page.getByLabel('Name').fill('Jordan');
		await page.getByLabel('Age').fill('51');
		await page.getByLabel('Height cm').fill('190');
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();

		// Open the form again and make changes, then cancel
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		await page.getByLabel('Name').fill('Alex');
		await page.getByLabel('Age').fill('99');
		await page.getByLabel('Height cm').fill('100');

		// Click Cancel
		await page.getByRole('button', { name: 'Cancel' }).click();

		// Verify we're back on the You page
		await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();

		// Verify the profile was not changed
		await page.getByRole('button', { name: 'Redo setup' }).click();
		await expect(page.getByText('A few quiet facts.')).toBeVisible();

		await expect(page.getByLabel('Name')).toHaveValue('Jordan');
		await expect(page.getByLabel('Age')).toHaveValue('51');
		await expect(page.getByLabel('Height cm')).toHaveValue('190');
	});
});
