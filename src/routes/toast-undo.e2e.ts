import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	EGG_ROW,
	openEmptyJournal,
	openLogSheet,
	signInThroughApi,
	stubFoodSearch
} from '../../tests/e2e-support';

/**
 * One-tap logging (search's `+`, and `RecentFoodList`'s row tap) writes to the
 * journal immediately and leans on the toast that follows to catch a mis-tap:
 * `Undo` removes exactly the entry the toast named, by its id, and `Dismiss`
 * waves the toast off without touching anything. This covers the search path;
 * `RecentFoodList`'s own tap-to-relog shares the same store method and the
 * same `Toaster`, so it is covered at the unit level instead of doubling this
 * flow end to end.
 */
test('logging a food from search and pressing Undo removes it from the day (#toast-undo)', async ({
	page,
	baseURL
}) => {
	await signInThroughApi(page, baseURL ?? '');
	await stubFoodSearch(page, [EGG_ROW]);
	await openEmptyJournal(page);

	await openLogSheet(page);
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'Search', exact: true }).click();
	await sheet.getByLabel('Search foods, brands, barcodes').fill('egg');
	await sheet.getByRole('button', { name: 'Log Egg, large', exact: true }).click();

	const undo = page.getByRole('button', { name: 'Undo', exact: true });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect(undo).toBeHidden();

	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByText('Egg, large')).toHaveCount(0);
});
