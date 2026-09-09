import { expect, type Page } from '@playwright/test';
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
 *
 * Neither case closes the sheet first: on a phone the Log sheet's own header
 * sits close enough to the top of the screen that the toast's own buttons can
 * cover its "Close" control, and clicking blind through that would only wait
 * out the toast's five-second window rather than prove anything about Undo or
 * Dismiss. Reading the journal with the sheet still open is enough — see
 * `eggRow` below for how that avoids the sheet's own rows of the same name.
 */
async function logEggFromSearch(page: Page) {
	await stubFoodSearch(page, [EGG_ROW]);
	await openEmptyJournal(page);

	await openLogSheet(page);
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'Search', exact: true }).click();
	await sheet.getByLabel('Search foods, brands, barcodes').fill('egg');
	await sheet.getByRole('button', { name: 'Log Egg, large', exact: true }).click();
}

/**
 * The day's journal row for a logged egg, and only that.
 *
 * With the sheet still open, its Search tab's own result row and its History
 * list both carry a button naming the same food, and both live inside
 * `[role="dialog"]` — the journal row underneath does not, which is what
 * `:not([role="dialog"] *)` excludes them by.
 */
function eggRow(page: Page) {
	return page.locator('button:not([role="dialog"] *)').filter({ hasText: 'Egg, large' });
}

test('logging a food from search and pressing Undo removes it from the day (#toast-undo)', async ({
	page,
	baseURL
}) => {
	await signInThroughApi(page, baseURL ?? '');
	await logEggFromSearch(page);

	// Present before Undo is pressed — otherwise its disappearance afterwards
	// would prove nothing.
	await expect(eggRow(page)).toBeVisible();

	const undo = page.getByRole('button', { name: 'Undo', exact: true });
	await expect(undo).toBeVisible();
	await undo.click();

	await expect(undo).toBeHidden();
	await expect(eggRow(page)).toHaveCount(0);
});

test('logging a food from search and pressing Dismiss leaves it in the day (#toast-undo)', async ({
	page,
	baseURL
}) => {
	await signInThroughApi(page, baseURL ?? '');
	await logEggFromSearch(page);

	await expect(eggRow(page)).toBeVisible();

	const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
	await expect(dismiss).toBeVisible();
	await dismiss.click();

	await expect(dismiss).toBeHidden();
	// Dismiss only closes the toast — the entry it named is still logged.
	await expect(eggRow(page)).toBeVisible();
});
