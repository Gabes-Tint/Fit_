import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	OLIVE_OIL_ROW,
	openEmptyJournal,
	openLogSheetAndType,
	signInThroughApi,
	stubFoodResolve
} from '../../tests/e2e-support';

/**
 * Issue #111: "2 tablespoons olive oil" was logged as 2 servings — the whole
 * bottle's worth, one serving at a time — instead of 2 tablespoons, because
 * `classifyUnit` did not accept the long spelling `portions.ts` already
 * accepted on a catalog label. Drives the real Log sheet end to end and
 * checks the same kcal `LogSheet.svelte.spec.ts` asserts for the short form
 * "2 tbsp olive oil" (238 kcal: olive oil is a 14 g, 119 kcal tablespoon).
 */
test.describe('a typed unit spelling matches its abbreviation', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodResolve(page, [OLIVE_OIL_ROW]);
		await openEmptyJournal(page);
	});

	test('"2 tablespoons olive oil" logs the same calories as "2 tbsp olive oil"', async ({
		page
	}) => {
		await openLogSheetAndType(page, '2 tablespoons olive oil');
		await page.getByRole('button', { name: 'Parse' }).click();
		// Same volume hint the short spelling shows (LogSheet.svelte.spec.ts):
		// proof the long spelling was read as a volume, not as 2 bare servings.
		await expect(page.getByText('1 tbsp (15 ml)')).toBeVisible();

		await page.getByRole('button', { name: 'Add to today' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		// The logged row itself: its accessible name carries the food, the
		// portion, and the calories together, so this also proves the entry was
		// recorded as 2 tablespoons rather than as 2 bare servings.
		await expect(
			page.getByRole('button', { name: 'Olive oil USDA 2 × 1 tbsp (15 ml) · 28 g 238' })
		).toBeVisible();
	});
});
