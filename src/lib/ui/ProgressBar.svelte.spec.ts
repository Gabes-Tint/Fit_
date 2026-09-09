import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProgressBar from './ProgressBar.svelte';

/** The filled part of the bar. */
function fill() {
	return document.body.querySelector<HTMLElement>('.bg-primary');
}

describe('ProgressBar', () => {
	it('fills part-way to the target', async () => {
		await render(ProgressBar, { props: { value: 60, target: 120 } });
		expect(fill()?.style.width).toBe('50%');
	});

	it('caps at the target rather than overflowing', async () => {
		await render(ProgressBar, { props: { value: 500, target: 100 } });
		expect(fill()?.style.width).toBe('100%');
	});

	it('stays empty when nothing has been logged', async () => {
		await render(ProgressBar, { props: { value: 0, target: 120 } });
		expect(fill()?.style.width).toBe('0%');
	});

	it('stays empty for a zero target rather than dividing by zero', async () => {
		await render(ProgressBar, { props: { value: 50, target: 0 } });
		expect(fill()?.style.width).toBe('0%');
	});

	it('moves when the value changes', async () => {
		const props = $state({ value: 0, target: 120 });
		await render(ProgressBar, { props });
		props.value = 30;
		await expect.poll(() => fill()?.style.width).toBe('25%');
	});

	it('merges a caller-supplied class', async () => {
		await render(ProgressBar, { props: { value: 1, target: 2, class: 'mt-1' } });
		expect(document.body.querySelector('.bg-secondary')?.className).toMatch(/mt-1/);
	});

	it('stays out of the accessibility tree, because the reading beside it is the content', async () => {
		await render(ProgressBar, { props: { value: 1, target: 2 } });
		expect(document.body.querySelector('.bg-secondary')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('defaults the fill colour to bg-primary', async () => {
		await render(ProgressBar, { props: { value: 1, target: 2 } });
		expect(fill()).not.toBeNull();
	});

	it('lets a caller override the fill colour with barClass', async () => {
		await render(ProgressBar, { props: { value: 1, target: 2, barClass: 'bg-destructive' } });
		expect(fill()).toBeNull();
		expect(document.body.querySelector('.bg-destructive')).not.toBeNull();
	});
});
