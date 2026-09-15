import { expect } from '@playwright/test';
import { test } from '../../../tests/preview-server';
import {
	openExerciseTabEmpty as onboard,
	pickFullBodyTemplate as pickFullBody,
	atNarrowPhone,
	expectFitsViewport,
	expectHittable
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
		await expect(page.getByRole('heading', { name: 'Bench Press', level: 1 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Seated Row', level: 1 })).toBeVisible();

		// Each should have their own set table
		const squat = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const bench = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench Press', { exact: true }) });
		const seatedRow = page
			.getByRole('region')
			.filter({ has: page.getByText('Seated Row', { exact: true }) });

		// Each exercise region should have an Add set button
		await expect(squat.getByRole('button', { name: 'Add set' })).toBeVisible();
		await expect(bench.getByRole('button', { name: 'Add set' })).toBeVisible();
		await expect(seatedRow.getByRole('button', { name: 'Add set' })).toBeVisible();
	});

	test('does not show Exercise N of M counter or Next exercise button', async ({ page }) => {
		// Should not have any text matching the "Exercise 1 of 3" pattern
		await expect(page.getByText(/Exercise \d+ of \d+/)).toHaveCount(0);

		// Should not have a "Next exercise" button
		await expect(page.getByRole('button', { name: 'Next exercise' })).toHaveCount(0);
	});

	test('ticking a set in the second exercise only affects that exercise', async ({ page }) => {
		// Find the set button for set 1 in the Bench Press section
		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench Press', { exact: true }) });

		// Get the set 1 done button for bench press
		const benchSet1Button = benchSection.getByRole('button', { name: 'Set 1 done' }).first();
		await benchSet1Button.click();

		// Bench Press set 1 should be marked done
		await expect(benchSet1Button).toHaveAttribute('aria-pressed', 'true');

		// Squat set 1 should still be undone
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatSet1Button = squatSection.getByRole('button', { name: 'Set 1 done' }).first();
		await expect(squatSet1Button).toHaveAttribute('aria-pressed', 'false');

		// Seated Row set 1 should still be undone
		const seatedRowSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Seated Row', { exact: true }) });
		const seatedRowSet1Button = seatedRowSection
			.getByRole('button', { name: 'Set 1 done' })
			.first();
		await expect(seatedRowSet1Button).toHaveAttribute('aria-pressed', 'false');
	});

	test('renders exactly one Notes field at session level', async ({ page }) => {
		// The session-level Notes field should have placeholder "How did the session go?"
		await expect(page.getByPlaceholder('How did the session go?')).toHaveCount(1);
	});

	test('Notes field is not inside any exercise region', async ({ page }) => {
		// Every exercise block is a region named after the movement, so the claim
		// is answered by asking each region for a Notes field of its own.
		for (const name of ['Squat', 'Bench Press', 'Seated Row']) {
			const region = page.getByRole('region', { name });
			await expect(region).toBeVisible();
			await expect(region.getByLabel('Notes')).toHaveCount(0);
		}
		await expect(page.getByLabel('Notes')).toHaveCount(1);
	});

	test('typing in Notes field stores text on workout', async ({ page }) => {
		const notesInput = page.getByPlaceholder('How did the session go?');
		await notesInput.fill('Great session today');
		await expect(notesInput).toHaveValue('Great session today');
	});

	test('text in Notes field persists when sets are ticked', async ({ page }) => {
		const notesInput = page.getByPlaceholder('How did the session go?');
		await notesInput.fill('Test note for session');

		// Tick a set in the first exercise
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatSet1Button = squatSection.getByRole('button', { name: 'Set 1 done' }).first();
		await squatSet1Button.click();

		// Verify text is still there
		await expect(notesInput).toHaveValue('Test note for session');
	});

	test('note persists after ticking sets in multiple exercises', async ({ page }) => {
		const notesInput = page.getByPlaceholder('How did the session go?');
		await notesInput.fill('My workout note');

		// Tick a set in Squat
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatSet1 = squatSection.getByRole('button', { name: 'Set 1 done' }).first();
		await squatSet1.click();

		// Tick a set in Bench Press
		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench Press', { exact: true }) });
		const benchSet1 = benchSection.getByRole('button', { name: 'Set 1 done' }).first();
		await benchSet1.click();

		// Verify note is still there
		await expect(notesInput).toHaveValue('My workout note');
	});

	test('footer button labels the next undone set and reads Finish when all sets done', async ({
		page
	}) => {
		// Initial state: should label "Log Squat set 1"
		let footerButton = page.getByRole('button', {
			name: /Log (Squat|Bench Press|Seated Row) set \d+/
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

		// Now button should label "Log Bench Press set 1"
		footerButton = page.getByRole('button', { name: /Log (Bench Press|Seated Row) set \d+/ });
		await expect(footerButton).toContainText('Bench Press');
		await expect(footerButton).toContainText('set 1');

		// Tick all sets in Bench Press
		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench Press', { exact: true }) });
		const benchSet1 = benchSection.getByRole('button', { name: 'Set 1 done' }).first();
		const benchSet2 = benchSection.getByRole('button', { name: 'Set 2 done' }).first();
		const benchSet3 = benchSection.getByRole('button', { name: 'Set 3 done' }).first();

		await benchSet1.click();
		await benchSet2.click();
		await benchSet3.click();

		// Now button should label "Log Seated Row set 1"
		footerButton = page.getByRole('button', { name: /Log Seated Row set \d+/ });
		await expect(footerButton).toContainText('Seated Row');
		await expect(footerButton).toContainText('set 1');

		// Tick all sets in Seated Row
		const seatedRowSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Seated Row', { exact: true }) });
		const seatedRowSet1 = seatedRowSection.getByRole('button', { name: 'Set 1 done' }).first();
		const seatedRowSet2 = seatedRowSection.getByRole('button', { name: 'Set 2 done' }).first();
		const seatedRowSet3 = seatedRowSection.getByRole('button', { name: 'Set 3 done' }).first();

		await seatedRowSet1.click();
		await seatedRowSet2.click();
		await seatedRowSet3.click();

		// Continue clicking footer button for remaining exercises: Machine Press (3), Barbell Curl (2), Calf Raise (3)
		// Click until we get to 17 of 17
		for (let i = 0; i < 8; i++) {
			footerButton = page.getByRole('button', { name: /^Log / });
			await footerButton.click();
		}

		// Button should now read "Finish"
		const finishButton = page.getByRole('button', { name: 'Finish' });
		await expect(finishButton).toBeVisible();

		// Clicking Finish should end the workout
		await finishButton.click();
		await expect(page.getByRole('heading', { name: 'Full body', level: 1 })).toBeVisible();
		await expect(page.getByText('Session done', { exact: true })).toBeVisible();
	});

	test('header shows overall sets count across all exercises', async ({ page }) => {
		// Full body has 6 exercises with a total of 17 sets
		// Header should show "X of 17 sets"
		await expect(page.getByText(/\d+ of \d+ sets/)).toBeVisible();

		// The exact count should be "0 of 17 sets" initially (no sets ticked)
		const initialCount = page.getByText('0 of 17 sets');
		await expect(initialCount).toBeVisible();

		// Tick one set in squat
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatSet1 = squatSection.getByRole('button', { name: 'Set 1 done' }).first();
		await squatSet1.click();

		// Header should now show "1 of 17 sets"
		await expect(page.getByText('1 of 17 sets')).toBeVisible();

		// Tick another set in bench
		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench Press', { exact: true }) });
		const benchSet1 = benchSection.getByRole('button', { name: 'Set 1 done' }).first();
		await benchSet1.click();

		// Header should now show "2 of 17 sets"
		await expect(page.getByText('2 of 17 sets')).toBeVisible();
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
			.filter({ has: page.getByText('Bench Press', { exact: true }) });
		const benchAddSet = benchSection.getByRole('button', { name: 'Add set' });
		await benchAddSet.click();
		await benchAddSet.click();

		const seatedRowSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Seated Row', { exact: true }) });
		const seatedRowAddSet = seatedRowSection.getByRole('button', { name: 'Add set' });
		await seatedRowAddSet.click();
		await seatedRowAddSet.click();

		// Check that nothing overflows the viewport
		await expectFitsViewport(page);
	});

	test('Notes field at 360px viewport is not hidden behind sticky footer', async ({ page }) => {
		await atNarrowPhone(page);

		// Add 2 more sets to each of the three exercises to have 5 sets per exercise
		const squatSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Squat', { exact: true }) });
		const squatAddSet = squatSection.getByRole('button', { name: 'Add set' });
		await squatAddSet.click();
		await squatAddSet.click();

		const benchSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Bench Press', { exact: true }) });
		const benchAddSet = benchSection.getByRole('button', { name: 'Add set' });
		await benchAddSet.click();
		await benchAddSet.click();

		const seatedRowSection = page
			.getByRole('region')
			.filter({ has: page.getByText('Seated Row', { exact: true }) });
		const seatedRowAddSet = seatedRowSection.getByRole('button', { name: 'Add set' });
		await seatedRowAddSet.click();
		await seatedRowAddSet.click();

		const notesInput = page.getByPlaceholder('How did the session go?');
		await expect(notesInput).toBeVisible();

		// Nothing overflows sideways, and the field itself sits inside the 360px.
		await expectFitsViewport(page, notesInput);

		// Scrolled to, the sticky rest-timer strip must not be what a tap lands on.
		await notesInput.scrollIntoViewIfNeeded();
		await expectHittable(notesInput);
	});
});
