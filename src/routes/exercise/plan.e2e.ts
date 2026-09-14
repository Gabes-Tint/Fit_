import { expect, type Page } from '@playwright/test';
import { test } from '../../../tests/preview-server';
import {
	openExerciseTabEmpty,
	pickFullBodyTemplate,
	expectFitsViewport,
	atNarrowPhone
} from '../../../tests/e2e-support';

async function openPlan(page: Page) {
	await page.getByRole('link', { name: 'Plan', exact: true }).click();
	await expect(page.getByRole('button', { name: /^Mon / })).toBeVisible();
}

async function setupSundaySept13WithRoutine(page: Page, baseURL: string) {
	const SUNDAY_SEPT_13 = new Date('2026-09-13T09:00:00');
	await page.clock.setFixedTime(SUNDAY_SEPT_13);
	await openExerciseTabEmpty(page, baseURL ?? '');
	await pickFullBodyTemplate(page);
	await openPlan(page);
}

test.describe('week planner "Today" label', () => {
	test('displays "Today, Sun 13" on the current day when today is September 13', async ({
		page,
		baseURL
	}) => {
		await setupSundaySept13WithRoutine(page, baseURL ?? '');

		const todayButton = page.getByRole('button', { name: /^Today, Sun 13/ });
		await expect(todayButton).toBeVisible();
		await expect(todayButton).toContainText('Today, Sun 13');
	});

	test('includes "Today, Sun 13" in the button accessible name', async ({ page, baseURL }) => {
		await setupSundaySept13WithRoutine(page, baseURL ?? '');
		await expect(page.getByRole('button', { name: /^Today, Sun 13/ })).toBeVisible();
	});

	test('does not show "Today" on other days of the same week', async ({ page, baseURL }) => {
		await setupSundaySept13WithRoutine(page, baseURL ?? '');

		const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		for (const day of days) {
			const dayButton = page.getByRole('button', { name: new RegExp(`^${day} `) });
			await expect(dayButton).toBeVisible();
			await expect(dayButton).not.toContainText('Today');
		}
	});

	test('removes "Today" label when navigating to previous week', async ({ page, baseURL }) => {
		await setupSundaySept13WithRoutine(page, baseURL ?? '');
		await expect(page.getByRole('button', { name: /^Today, Sun 13/ })).toBeVisible();

		await page.getByRole('button', { name: 'Previous week' }).click();
		await expect(page.getByRole('button', { name: /^Mon / })).toBeVisible();
		await expect(page.getByRole('button', { name: /^Today, / })).toHaveCount(0);
	});

	test('removes "Today" label when navigating to next week', async ({ page, baseURL }) => {
		await setupSundaySept13WithRoutine(page, baseURL ?? '');
		await expect(page.getByRole('button', { name: /^Today, Sun 13/ })).toBeVisible();

		await page.getByRole('button', { name: 'Next week' }).click();
		await expect(page.getByRole('button', { name: /^Mon / })).toBeVisible();
		await expect(page.getByRole('button', { name: /^Today, / })).toHaveCount(0);
	});

	test('shows "Today" label again after navigating away and back to current week', async ({
		page,
		baseURL
	}) => {
		await setupSundaySept13WithRoutine(page, baseURL ?? '');
		await expect(page.getByRole('button', { name: /^Today, Sun 13/ })).toBeVisible();

		await page.getByRole('button', { name: 'Previous week' }).click();
		await page.getByRole('button', { name: 'Next week' }).click();

		await expect(page.getByRole('button', { name: /^Today, Sun 13/ })).toBeVisible();
	});

	test('fits viewport at 360px wide with rest day', async ({ page, baseURL }) => {
		await setupSundaySept13WithRoutine(page, baseURL ?? '');

		await atNarrowPhone(page);
		const todayButton = page.getByRole('button', { name: /^Today, Sun 13/ });
		await expect(todayButton).toBeVisible();
		await expectFitsViewport(page, todayButton);
	});

	test('fits viewport at 360px wide with multiple routines on today', async ({ page, baseURL }) => {
		const WEDNESDAY_SEPT_30 = new Date('2026-09-30T09:00:00');
		await page.clock.setFixedTime(WEDNESDAY_SEPT_30);
		await openExerciseTabEmpty(page, baseURL ?? '');
		await pickFullBodyTemplate(page);

		await openPlan(page);

		// Plan Full body on today (Wed 30) four times
		const todayButton = page.getByRole('button', { name: /^Today, Wed 30/ });
		for (let i = 0; i < 4; i++) {
			await todayButton.click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await page
				.getByRole('dialog')
				.getByRole('button', { name: /Full body/ })
				.click();
			await expect(page.getByRole('dialog')).toBeHidden();
		}

		await atNarrowPhone(page);
		const chipsInRow = todayButton.locator('[class*="chip"]');
		await expect(chipsInRow).toHaveCount(4);
		await expectFitsViewport(page, todayButton);
	});
});
