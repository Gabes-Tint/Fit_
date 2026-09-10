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

	/**
	 * A sheet or a modal is painted over this button, and every one of them traps
	 * focus inside itself, so nothing should reach here while one is up. This is
	 * the guard behind those two, and the failure it prevents is a silent one:
	 * a navigation drawer opened underneath an open sheet, out of sight and out
	 * of reach, with this button reporting it as expanded.
	 */
	it('does nothing while a sheet or a modal is over it', async () => {
		const ontoggle = vi.fn();
		await render(MenuFab, { props: { ...base, ontoggle } });
		const sheet = document.createElement('div');
		sheet.setAttribute('data-dialog-content', '');
		document.body.append(sheet);
		try {
			await page.getByRole('button', { name: 'Open menu' }).click();
			expect(ontoggle).not.toHaveBeenCalled();
		} finally {
			sheet.remove();
		}
	});

	// Its own drawer is not something in its way: that one it opened, and the
	// same tap has to be able to close it again.
	it('still answers while its own drawer is the dialog on screen', async () => {
		const ontoggle = vi.fn();
		await render(MenuFab, { props: { ...base, open: true, ontoggle } });
		const drawer = document.createElement('div');
		drawer.setAttribute('data-dialog-content', '');
		// `String` because a value imported from a `.svelte` module block reaches
		// the lint's type checker untyped, and `id` wants a string.
		drawer.setAttribute('id', String(DRAWER_ID));
		document.body.append(drawer);
		try {
			await page.getByRole('button', { name: 'Close menu' }).click();
			expect(ontoggle).toHaveBeenCalled();
		} finally {
			drawer.remove();
		}
	});

	it('sits bottom-right by default', async () => {
		await render(MenuFab, { props: { ...base } });
		const button = page.getByRole('button', { name: 'Open menu' }).element();
		expect(button.closest('div')?.className).toMatch(/justify-end/);
		expect(button.closest('div')?.parentElement?.className).toMatch(/pr-\[max\(0\.75rem/);
	});

	it('mirrors bottom-left when left-handed', async () => {
		await render(MenuFab, { props: { ...base, leftHanded: true } });
		const button = page.getByRole('button', { name: 'Open menu' }).element();
		expect(button.closest('div')?.className).toMatch(/justify-start/);
		expect(button.closest('div')?.parentElement?.className).toMatch(/pl-\[max\(0\.75rem/);
	});

	// The rest of what this button has to be — a 44px target, a stacking order
	// above the drawer's own overlay, and a wrapper that swallows no taps — is
	// entirely a matter of the stylesheet, and this project renders components
	// without one. Those are asserted against the built app, at phone width,
	// in `phone-layout.e2e.ts`.
});
