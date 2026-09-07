import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import SheetHarness from './SheetHarness.svelte';

describe('Sheet', () => {
	it('shows nothing while closed', async () => {
		await render(SheetHarness, { props: { open: false, body: 'Sheet body' } });
		expect(document.body.textContent).not.toContain('Sheet body');
	});

	it('shows its content when open', async () => {
		await render(SheetHarness, { props: { open: true, body: 'Sheet body' } });
		await expect.element(page.getByText('Sheet body')).toBeInTheDocument();
	});

	it('names itself for screen readers', async () => {
		await render(SheetHarness, { props: { open: true, body: 'Sheet body' } });
		await expect.element(page.getByRole('dialog', { name: 'Log' })).toBeInTheDocument();
	});

	it('describes itself when given a description', async () => {
		await render(SheetHarness, {
			props: { open: true, body: 'Sheet body', description: 'How it works' }
		});
		expect(document.body.textContent).toContain('How it works');
	});

	it('offers no close control unless one is wanted', async () => {
		await render(SheetHarness, { props: { open: true, body: 'Sheet body' } });
		expect(document.querySelector('[aria-label="Close"]')).toBeNull();
	});

	it('closes from the close control when one is provided', async () => {
		const props = $state({ open: true, body: 'Sheet body', closable: true });
		await render(SheetHarness, { props });
		await page.getByRole('button', { name: 'Close' }).click();
		expect(props.open).toBe(false);
	});

	it('closes on Escape', async () => {
		const props = $state({ open: true, body: 'Sheet body' });
		await render(SheetHarness, { props });
		await page.getByRole('dialog').click();
		await userEscape();
		expect(props.open).toBe(false);
	});

	/**
	 * `tall` takes 95% of the viewport height on a phone, staying anchored to
	 * the bottom with rounded top corners — it still reads as a sheet with the
	 * page visible above it, not an edge-to-edge screen — and reverts to the
	 * normal bottom-sheet sizing at `sm:` and up. Asserted on the class string
	 * rather than a real viewport: Tailwind's `sm:` prefix is CSS media-query
	 * behavior a browser applies, not something jsdom or a fixed test viewport
	 * proves either way — the class list is the contract.
	 */
	const TALL_BASE = [
		'h-[95dvh]',
		'max-h-[95dvh]',
		'max-w-none',
		'pb-[env(safe-area-inset-bottom)]'
	] as const;
	const TALL_REVERT = ['sm:h-auto', 'sm:max-h-[90dvh]', 'sm:max-w-lg', 'sm:pb-0'] as const;

	describe('tall', () => {
		it('takes 95% of the viewport height below `sm`, anchored to the bottom with rounded top corners', async () => {
			await render(SheetHarness, { props: { open: true, body: 'Sheet body', tall: true } });
			const panel = page.getByRole('dialog');
			for (const cls of [...TALL_BASE, ...TALL_REVERT]) {
				await expect.element(panel).toHaveClass(cls);
			}
			await expect.element(panel).toHaveClass('inset-x-0');
			await expect.element(panel).toHaveClass('bottom-0');
			await expect.element(panel).toHaveClass('rounded-t-3xl');
		});

		it('leaves the bottom-sheet sizing alone when unset', async () => {
			await render(SheetHarness, { props: { open: true, body: 'Sheet body' } });
			const panel = page.getByRole('dialog');
			for (const cls of TALL_BASE) {
				await expect.element(panel).not.toHaveClass(cls);
			}
			await expect.element(panel).toHaveClass('max-h-[92dvh]');
			await expect.element(panel).toHaveClass('rounded-t-3xl');
		});
	});
});

async function userEscape() {
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 50));
}
