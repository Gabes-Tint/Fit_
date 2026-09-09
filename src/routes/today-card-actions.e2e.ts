import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openSampleJournal, signInThroughApi } from '../../tests/e2e-support';

/**
 * The Today page's Energy, Weight and Training cards each grew a per-card
 * action (#today-card-actions): a "Log food" button that opens the shared log
 * sheet, a "Log weight" button that expands an inline entry form, and a
 * "Go to training" link to the Exercise route. This walks the food and
 * weight actions end to end; the training link's href is asserted at the
 * component level (`TodayView.svelte.spec.ts`), and phone-width layout for
 * all three is covered in `phone-layout.e2e.ts`.
 */
test('logs food and a weight entry from the Today cards', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	await page.goto('/');
	await openSampleJournal(page);

	// The Energy card's own button opens the same sheet the rest of the app uses.
	// Scoped to the card: the floating log button carries the same accessible
	// name, so an unscoped query would be ambiguous here.
	const energyCard = page.getByRole('region', { name: 'Energy' });
	await energyCard.getByRole('button', { name: 'Log food' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();

	// The Weight card expands in place rather than opening a sheet.
	const chart = page.getByRole('img', { name: /Weight trend/ });
	const captionBefore = await chart.getAttribute('aria-label');

	await page.getByRole('button', { name: 'Log weight' }).click();
	await expect(page.getByLabel('Weight in kilograms')).toBeVisible();

	await page.getByLabel('Weight in kilograms').fill('82');
	await page.getByRole('button', { name: 'Today', exact: true }).click();

	// The chart redraws with the new point.
	await expect(chart).not.toHaveAttribute('aria-label', captionBefore ?? '');

	// The section may stay open after a successful entry (it does here); closing is explicit.
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByLabel('Weight in kilograms')).toBeHidden();
});
