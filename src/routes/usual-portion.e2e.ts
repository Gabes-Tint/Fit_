import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import {
	CHIPS_NAME,
	CHIPS_ROW,
	openEmptyJournal,
	openLogCardFor,
	signInThroughApi,
	stubFoodSearch
} from '../../tests/e2e-support';

/**
 * #159: the log card opens at the portion this person usually logs of a food.
 *
 * Nothing is stored to make that work — `Profile.log` already holds every entry
 * with its food id and its servings, so the memory is the log itself and the
 * state document does not change shape. What this file proves is the round trip
 * a person actually makes: log a weight, come back, and find it waiting, with
 * the card saying why and a way back to the label serving.
 */

/** Log the chips at a weight nobody could reach by tapping: 45 g of a 28 g serving. */
async function logFortyFiveGrams(page: Page) {
	await page.getByLabel('Enter the amount in grams').click();
	await page.getByLabel('Amount in grams').fill('45');
	await page.getByRole('button', { name: 'Add to today' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
}

test.describe('the portion you usually log', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await signInThroughApi(page, baseURL ?? '');
		await stubFoodSearch(page, [CHIPS_ROW]);
		await openEmptyJournal(page);
	});

	test('a food logged at 45 g opens at 45 g the next time, and says why', async ({ page }) => {
		await openLogCardFor(page, CHIPS_NAME);
		// Never logged before: the source serving, not an invented 100 g (#157),
		// and nothing claiming to know a usual it has never been told.
		await expect(page.getByLabel('Amount in servings')).toHaveValue('1');
		await expect(page.getByText(/Your usual/)).toHaveCount(0);

		await logFortyFiveGrams(page);
		await openLogCardFor(page, CHIPS_NAME);

		// Read back as the weight it was typed as: 1.607 servings is the
		// arithmetic behind 45 g, and showing that count would be showing a
		// number the person never chose.
		await expect(page.getByLabel('Amount in grams')).toHaveValue('45');
		await expect(page.getByText('Your usual · 1.61 × 1 oz · 45 g')).toBeVisible();
	});

	test('one tap on the label serving leaves the usual behind', async ({ page }) => {
		await openLogCardFor(page, CHIPS_NAME);
		await logFortyFiveGrams(page);
		await openLogCardFor(page, CHIPS_NAME);

		await page.getByRole('button', { name: '1 oz' }).click();
		await expect(page.getByLabel('Amount in servings')).toHaveValue('1');
		// One 28 g serving of a 500 kcal/100 g food, which is what "back to the
		// label serving" has to come to if the tap did anything at all.
		await expect(page.getByText(/^140 kcal/)).toBeVisible();
	});
});
