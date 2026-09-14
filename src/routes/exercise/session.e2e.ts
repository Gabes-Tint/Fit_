import { expect } from '@playwright/test';
import { test } from '../../../tests/preview-server';
import {
	openExerciseTabEmpty as onboard,
	pickFullBodyTemplate as pickFullBody,
	expectFitsViewport
} from '../../../tests/e2e-support';

test.describe('live workout with all exercises on one page', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		await onboard(page, baseURL ?? '');
		await pickFullBody(page);
		await page.getByRole('button', { name: 'Start Full body' }).click();
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();
	});

	test('renders all three exercises as blocks in routine order', async ({ page }) => {
		// All three exercises from Full body should be visible
		await expect(page.getByRole('heading', { name: 'Squat', level: 1 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Bench press', level: 1 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Deadlift', level: 1 })).toBeVisible();

		// Each should have their own set table
		const squat = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const bench = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench press', { exact: true }) });
		const deadlift = page
			.getByRole('region')
			.filter({ has: page.getByText('Deadlift', { exact: true }) });

		// Each exercise region should have an Add set button
		await expect(squat.getByRole('button', { name: 'Add set' })).toBeVisible();
		await expect(bench.getByRole('button', { name: 'Add set' })).toBeVisible();
		await expect(deadlift.getByRole('button', { name: 'Add set' })).toBeVisible();
	});

	test('does not show Exercise N of M counter or Next exercise button', async ({ page }) => {
		// Should not have any text matching the "Exercise 1 of 3" pattern
		await expect(page.getByText(/Exercise \d+ of \d+/)).toHaveCount(0);

		// Should not have a "Next exercise" button
		await expect(page.getByRole('button', { name: 'Next exercise' })).toHaveCount(0);
	});

	test('ticking a set in the second exercise only affects that exercise', async ({ page }) => {
		// Find the set button for set 1 in the Bench press section
		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench press', { exact: true }) });

		// Get the set 1 done button for bench press
		const benchSet1Button = benchSection.getByRole('button', { name: 'Set 1 done' }).first();
		await benchSet1Button.click();

		// Bench press set 1 should be marked done
		await expect(benchSet1Button).toHaveAttribute('aria-pressed', 'true');

		// Squat set 1 should still be undone
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatSet1Button = squatSection.getByRole('button', { name: 'Set 1 done' }).first();
		await expect(squatSet1Button).toHaveAttribute('aria-pressed', 'false');

		// Deadlift set 1 should still be undone
		const deadliftSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Deadlift', { exact: true }) });
		const deadliftSet1Button = deadliftSection.getByRole('button', { name: 'Set 1 done' }).first();
		await expect(deadliftSet1Button).toHaveAttribute('aria-pressed', 'false');
	});

	test('notes field persists per-exercise', async ({ page }) => {
		// Find the notes field for the third exercise (Deadlift)
		const deadliftSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Deadlift', { exact: true }) });
		const deadliftNotes = deadliftSection.getByLabel('Notes');

		// Type a note in Deadlift
		await deadliftNotes.fill('Good form today');
		await expect(deadliftNotes).toHaveValue('Good form today');

		// Check that Squat and Bench notes are empty
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatNotes = squatSection.getByLabel('Notes');
		await expect(squatNotes).toHaveValue('');

		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench press', { exact: true }) });
		const benchNotes = benchSection.getByLabel('Notes');
		await expect(benchNotes).toHaveValue('');

		// Deadlift note should still be there
		await expect(deadliftNotes).toHaveValue('Good form today');
	});

	test('footer button labels the next undone set and reads Finish when all sets done', async ({
		page
	}) => {
		// Initial state: should label "Log squat set 1"
		let footerButton = page.getByRole('button', {
			name: /Log (Squat|Bench press|Deadlift) set \d+/
		});
		await expect(footerButton).toBeVisible();
		await expect(footerButton).toContainText('set 1');

		// Tick all sets in Squat
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatSet1 = squatSection.getByRole('button', { name: 'Set 1 done' }).first();
		const squatSet2 = squatSection.getByRole('button', { name: 'Set 2 done' }).first();
		const squatSet3 = squatSection.getByRole('button', { name: 'Set 3 done' }).first();

		await squatSet1.click();
		await squatSet2.click();
		await squatSet3.click();

		// Now button should label "Log bench press set 1"
		footerButton = page.getByRole('button', { name: /Log (Bench press|Deadlift) set \d+/ });
		await expect(footerButton).toContainText('Bench press');
		await expect(footerButton).toContainText('set 1');

		// Tick all sets in Bench press
		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench press', { exact: true }) });
		const benchSet1 = benchSection.getByRole('button', { name: 'Set 1 done' }).first();
		const benchSet2 = benchSection.getByRole('button', { name: 'Set 2 done' }).first();
		const benchSet3 = benchSection.getByRole('button', { name: 'Set 3 done' }).first();

		await benchSet1.click();
		await benchSet2.click();
		await benchSet3.click();

		// Now button should label "Log deadlift set 1"
		footerButton = page.getByRole('button', { name: /Log Deadlift set \d+/ });
		await expect(footerButton).toContainText('Deadlift');
		await expect(footerButton).toContainText('set 1');

		// Tick all sets in Deadlift
		const deadliftSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Deadlift', { exact: true }) });
		const deadliftSet1 = deadliftSection.getByRole('button', { name: 'Set 1 done' }).first();
		const deadliftSet2 = deadliftSection.getByRole('button', { name: 'Set 2 done' }).first();
		const deadliftSet3 = deadliftSection.getByRole('button', { name: 'Set 3 done' }).first();

		await deadliftSet1.click();
		await deadliftSet2.click();
		await deadliftSet3.click();

		// Button should now read "Finish"
		const finishButton = page.getByRole('button', { name: 'Finish' });
		await expect(finishButton).toBeVisible();

		// Clicking Finish should end the workout
		await finishButton.click();
		await expect(page.getByRole('heading', { name: 'Full body', level: 1 })).toBeVisible();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
	});

	test('header shows overall sets count across all exercises', async ({ page }) => {
		// Full body has 3 exercises with 3 sets each = 9 total sets
		// Header should show "3 of 9 sets" or similar
		await expect(page.getByText(/\d+ of \d+ sets/)).toBeVisible();

		// The exact count should be "0 of 9 sets" initially (no sets ticked)
		const initialCount = page.getByText('0 of 9 sets');
		await expect(initialCount).toBeVisible();

		// Tick one set in squat
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatSet1 = squatSection.getByRole('button', { name: 'Set 1 done' }).first();
		await squatSet1.click();

		// Header should now show "1 of 9 sets"
		await expect(page.getByText('1 of 9 sets')).toBeVisible();

		// Tick another set in bench
		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench press', { exact: true }) });
		const benchSet1 = benchSection.getByRole('button', { name: 'Set 1 done' }).first();
		await benchSet1.click();

		// Header should now show "2 of 9 sets"
		await expect(page.getByText('2 of 9 sets')).toBeVisible();
	});

	test('fits viewport at 360px with three exercises with five sets each', async ({ page }) => {
		// Set viewport to 360px wide
		await page.setViewportSize({ width: 360, height: 800 });

		// Full body only has 3 sets per exercise, so manually add 2 more sets per exercise
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatAddSet = squatSection.getByRole('button', { name: 'Add set' });
		await squatAddSet.click();
		await squatAddSet.click();

		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench press', { exact: true }) });
		const benchAddSet = benchSection.getByRole('button', { name: 'Add set' });
		await benchAddSet.click();
		await benchAddSet.click();

		const deadliftSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Deadlift', { exact: true }) });
		const deadliftAddSet = deadliftSection.getByRole('button', { name: 'Add set' });
		await deadliftAddSet.click();
		await deadliftAddSet.click();

		// Check that nothing overflows the viewport
		await expectFitsViewport(page);
	});
});
