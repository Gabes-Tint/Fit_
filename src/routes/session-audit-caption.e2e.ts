import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { signInThroughApi, openSampleJournal } from '../../tests/e2e-support';

test('session audit caption displays on home route', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	await page.goto('/');
	await openSampleJournal(page);

	const caption = page.getByRole('region', { name: 'Session audit caption' });
	await expect(caption).toBeVisible();
});

test('session audit caption displays time format', async ({ page, baseURL }) => {
	await signInThroughApi(page, baseURL ?? '');
	await page.goto('/');
	await openSampleJournal(page);

	const caption = page.getByRole('region', { name: 'Session audit caption' });
	await expect(caption).toContainText(/^.+\s·\s\d+\s+min$/);
});
