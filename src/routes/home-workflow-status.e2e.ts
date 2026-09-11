import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { signInThroughApi, openEmptyJournal } from '../../tests/e2e-support';

/**
 * The home route renders a workflow status chip that displays "Workflow check pending"
 * and an "Acknowledge workflow check" button that dismisses it for the current page session.
 */

test('renders the workflow status chip on the home route', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	await openEmptyJournal(page);

	const chip = page.getByText('Workflow check pending');
	await expect(chip).toBeVisible();
});

test('hides the chip when the acknowledge button is clicked', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	await openEmptyJournal(page);

	const chip = page.getByText('Workflow check pending');
	await expect(chip).toBeVisible();

	const button = page.getByRole('button', { name: 'Acknowledge workflow check' });
	await button.click();

	await expect(chip).toBeHidden();
});

test('persists the dismissal state for the current page session', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	await openEmptyJournal(page);

	const chip = page.getByText('Workflow check pending');
	await expect(chip).toBeVisible();

	const button = page.getByRole('button', { name: 'Acknowledge workflow check' });
	await button.click();

	await expect(chip).toBeHidden();

	// Navigate to another route and back to verify dismissal persists
	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('link', { name: 'Progress' }).click();
	await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();

	// Navigate back to home
	await page.getByRole('button', { name: 'Open menu' }).click();
	await page.getByRole('link', { name: 'Today' }).click();
	await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

	// The chip should still be hidden, proving dismissal persisted for the session
	await expect(chip).toBeHidden();
});
