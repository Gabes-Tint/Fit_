import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openSampleJournal, signInThroughApi, turnOnLeftHanded } from '../../tests/e2e-support';

/**
 * The left-handed preference mirrors the one persistent piece of chrome — the
 * floating menu toggle — and the drawer it opens, to the opposite side of the
 * screen. This is the end-to-end proof that turning it on from the You page
 * actually moves both, in a real browser, rather than only in a component
 * test that never lays either of them out against a real viewport.
 */
test('mirrors the menu toggle and the drawer once left-handed is turned on', async ({
	page,
	baseURL
}) => {
	await signInThroughApi(page, baseURL ?? '');
	await page.goto('/');
	await openSampleJournal(page);

	await turnOnLeftHanded(page);

	const viewport = page.viewportSize();
	expect(viewport, 'the page has no viewport to measure').not.toBeNull();
	const { width } = viewport as { width: number; height: number };

	const toggle = page.getByRole('button', { name: 'Open menu' });
	await expect(toggle).toBeVisible();
	const toggleBox = await toggle.boundingBox();
	expect(toggleBox, 'the menu toggle has no box to measure').not.toBeNull();
	const { x: toggleX, width: toggleWidth } = toggleBox as { x: number; width: number };
	expect(
		toggleX + toggleWidth,
		`the menu toggle's right edge is at ${toggleX + toggleWidth}px, past the left half of a ${width}px viewport`
	).toBeLessThanOrEqual(width / 2);

	await toggle.click();
	const drawer = page.getByRole('dialog', { name: 'Fit_' });
	await expect(drawer).toBeVisible();
	const drawerBox = await drawer.boundingBox();
	expect(drawerBox, 'the drawer has no box to measure').not.toBeNull();
	const { x: drawerX, width: drawerWidth } = drawerBox as { x: number; width: number };
	// The panel is anchored to the right edge (`right-0`), not centred in the
	// right half: at some viewport widths it is wider than half the screen, so
	// what proves it moved is that it now touches the right edge rather than
	// the left one, the way it did before this preference existed.
	expect(
		drawerX + drawerWidth,
		`the drawer's right edge is at ${drawerX + drawerWidth}px, short of the ${width}px viewport's own right edge`
	).toBeGreaterThanOrEqual(width - 1);
	expect(
		drawerX,
		`the drawer's left edge is at ${drawerX}px, flush with the viewport's left edge as though it had not mirrored`
	).toBeGreaterThan(0);
});
