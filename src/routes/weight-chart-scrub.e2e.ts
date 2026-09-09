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

	test('a real pointer drag across the chart shows the reading under it', async ({
		page,
		baseURL
	}) => {
		await signInThroughApi(page, baseURL ?? '');
		await page.goto('/');
		await openSampleJournal(page);

		const chart = page.getByRole('img', { name: /Weight trend from/ });
		await expect(chart).toBeVisible();
		await chart.scrollIntoViewIfNeeded();
		const box = await chart.boundingBox();
		expect(box, 'chart has no box to drag across').not.toBeNull();
		const { x, y, width, height } = box as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		const midY = y + height / 2;

		// The browser's own input plumbing rather than a dispatched event: pointer
		// capture, the coalescing of a moving pointer, and the client-to-viewBox
		// mapping the chart reads off `getScreenCTM` are all the engine's here, and
		// none of them is exercised by a `dispatchEvent`. The assertion is on the
		// reading appearing, not on what happens after release, because these events
		// do not arrive as the same kind of pointer everywhere: Chromium's mobile
		// emulation turns driven mouse input into touch, which the chart
		// deliberately treats differently on lift.
		await page.mouse.move(x + width * 0.2, midY);
		await page.mouse.down();
		await page.mouse.move(x + width * 0.5, midY, { steps: 5 });
		await page.mouse.move(x + width * 0.85, midY, { steps: 5 });

		await expect(page.getByText(/^[A-Z][a-z]{2} \d{1,2} · \d+\.\d (kg|lb)$/).first()).toBeVisible();

		await page.mouse.up();
	});
});
