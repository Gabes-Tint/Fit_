import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import MenuFab, { DRAWER_ID } from './MenuFab.svelte';

const base = { open: false, ontoggle: vi.fn() };

describe('MenuFab', () => {
	it('offers a way into the menu', async () => {
		await render(MenuFab, { props: { ...base } });
		await expect.element(page.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
	});

	it('raises the toggle when it is tapped shut', async () => {
		const ontoggle = vi.fn();
		await render(MenuFab, { props: { ...base, ontoggle } });
		await page.getByRole('button', { name: 'Open menu' }).click();
		expect(ontoggle).toHaveBeenCalled();
	});

	it('raises the same toggle when it is tapped open, which is how the drawer shuts', async () => {
		const ontoggle = vi.fn();
		await render(MenuFab, { props: { ...base, open: true, ontoggle } });
		await page.getByRole('button', { name: 'Close menu' }).click();
		expect(ontoggle).toHaveBeenCalled();
	});

	it('reports the menu as shut while it is', async () => {
		await render(MenuFab, { props: { ...base } });
		await expect
			.element(page.getByRole('button', { name: 'Open menu' }))
			.toHaveAttribute('aria-expanded', 'false');
	});

	it('renames itself once the drawer is open, because it is now the way out', async () => {
		const props = $state({ ...base });
		await render(MenuFab, { props });
		props.open = true;
		await expect.element(page.getByRole('button', { name: 'Close menu' })).toBeInTheDocument();
		expect(page.getByRole('button', { name: 'Open menu' }).elements()).toHaveLength(0);
	});

	it('reports the menu as open once it is', async () => {
		const props = $state({ ...base });
		await render(MenuFab, { props });
		props.open = true;
		await expect
			.element(page.getByRole('button', { name: 'Close menu' }))
			.toHaveAttribute('aria-expanded', 'true');
	});

	// The icon is the only thing that says which way the button will go to
	// somebody who is not listening to the name, so it is asserted rather than
	// assumed: a hamburger while there is a menu to open, an X while there is one
	// to close. `lucide` stamps the name it drew on the node.
	it('wears a hamburger while the drawer is shut', async () => {
		await render(MenuFab, { props: { ...base } });
		expect(document.querySelector('.lucide-menu')).not.toBeNull();
		expect(document.querySelector('.lucide-x')).toBeNull();
	});

	it('wears an X while the drawer is open', async () => {
		const props = $state({ ...base });
		await render(MenuFab, { props });
		props.open = true;
		await vi.waitFor(() => expect(document.querySelector('.lucide-x')).not.toBeNull());
		expect(document.querySelector('.lucide-menu')).toBeNull();
	});

	it('announces that the menu is a dialog', async () => {
		await render(MenuFab, { props: { ...base } });
		await expect
			.element(page.getByRole('button', { name: 'Open menu' }))
			.toHaveAttribute('aria-haspopup', 'dialog');
	});

	it('names the drawer it controls', async () => {
		await render(MenuFab, { props: { ...base } });
		await expect
			.element(page.getByRole('button', { name: 'Open menu' }))
			.toHaveAttribute('aria-controls', DRAWER_ID);
	});

	// The whole reason the drawer can tell this tap from any other one.
	it('marks itself so the drawer can tell its taps from an outside one', async () => {
		await render(MenuFab, { props: { ...base } });
		const button = page.getByRole('button', { name: 'Open menu' }).element();
		expect(button.closest('[data-menu-fab]')).toBe(button);
	});

	// The rest of what this button has to be — a 44px target, a stacking order
	// above the drawer's own overlay, and a wrapper that swallows no taps — is
	// entirely a matter of the stylesheet, and this project renders components
	// without one. Those are asserted against the built app, at phone width,
	// in `phone-layout.e2e.ts`.
});
