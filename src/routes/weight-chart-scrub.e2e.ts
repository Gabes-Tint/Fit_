import { expect } from '@playwright/test';
import { test } from '../../tests/preview-server';
import { openSampleJournal, signInThroughApi } from '../../tests/e2e-support';

/**
 * The weight trend chart's scrub interaction: dragging a finger across it
 * selects the nearest measurement and shows its date and weight. The sample
 * journal (the same seeding `onboarding.e2e.ts` uses) already carries a
 * couple of weeks of weigh-ins, so no separate weight-logging flow is needed
 * here — this only drives the chart Today already renders, and never touches
 * `TodayView` itself.
 */
test.describe('weight chart scrubbing', () => {
	test('a touch drag across the chart shows the date and weight under the finger', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await openSampleJournal(page);

		const chart = page.getByRole('img', { name: /Weight trend from/ });
		await expect(chart).toBeVisible();

		// A synthetic pointer drag rather than `page.touchscreen`: the component
		// listens for `pointerdown`/`pointermove` with `pointerType === 'touch'`,
		// which a dispatched `PointerEvent` carries directly and a native touch
		// gesture would only produce indirectly (and less portably across CI
		// runners) via the browser's own touch-to-pointer translation.
		await chart.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			const y = rect.top + rect.height / 2;
			const startX = rect.left + rect.width * 0.2;
			const endX = rect.left + rect.width * 0.85;
			const fire = (type: string, clientX: number) =>
				el.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						cancelable: true,
						pointerId: 7,
						pointerType: 'touch',
						clientX,
						clientY: y
					})
				);
			fire('pointerdown', startX);
			fire('pointermove', endX);
		});

		// The date-and-weight label the chart draws above the plot, matched
		// loosely on shape ("Sep 6 · 98.5 kg") rather than a specific reading —
		// the sample journal's exact weights are not this test's concern.
		const label = page.getByText(/^[A-Z][a-z]{2} \d{1,2} · \d+\.\d (kg|lb)$/).first();
		await expect(label).toBeVisible();
	});
});
