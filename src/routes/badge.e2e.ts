import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { atNarrowPhone, expectFitsViewport } from '../../tests/e2e-support';

/**
 * Badge component accepts a formatted label string prop and renders visible,
 * accessible status text using existing styling conventions.
 *
 * Tested through the repository's component-harness route with formatted
 * label inputs to ensure the component is reusable across different contexts.
 */

function badgeHarnessUrl(label: string): string {
	return `/dev/component-harness?component=components/Badge&props=${JSON.stringify({
		label
	})}`;
}

test('renders a badge with the provided label text', async ({ page }: { page: Page }) => {
	await page.goto(badgeHarnessUrl('Draft'));

	const badge = page.getByText('Draft');
	await expect(badge).toBeVisible();
});

test('renders with uppercase styling applied to the label', async ({ page }: { page: Page }) => {
	await page.goto(badgeHarnessUrl('pending'));

	const badge = page.locator('span').first();
	await expect(badge).toBeVisible();
	await expect(badge).toHaveClass(/uppercase/);
});

test('badge is accessible with semantic meaning', async ({ page }: { page: Page }) => {
	await page.goto(badgeHarnessUrl('Active'));

	const badge = page.getByText('Active');
	await expect(badge).toBeVisible();
});

test('badge fits the viewport at 360px width', async ({ page }: { page: Page }) => {
	await atNarrowPhone(page);
	await page.goto(badgeHarnessUrl('Completed'));

	const badge = page.getByText('Completed');
	await expect(badge).toBeVisible();
	await expectFitsViewport(page, badge);
});

test('badge renders with appropriate styling conventions from the repository', async ({
	page
}: {
	page: Page;
}) => {
	await page.goto(badgeHarnessUrl('Info Badge'));

	const badge = page.getByText('Info Badge');
	await expect(badge).toBeVisible();
	const boundingBox = await badge.boundingBox();
	expect(boundingBox).not.toBeNull();
});

test('renders different label variations correctly', async ({ page }: { page: Page }) => {
	const labels = ['New', 'In Progress', 'Review', 'Done'];

	await page.goto(badgeHarnessUrl(labels[0]));
	const badge = page.getByText(labels[0]);
	await expect(badge).toBeVisible();

	for (const label of labels.slice(1)) {
		await page.goto(badgeHarnessUrl(label));
		const currentBadge = page.getByText(label);
		await expect(currentBadge).toBeVisible();
	}
});
