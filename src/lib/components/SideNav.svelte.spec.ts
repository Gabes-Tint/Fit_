import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { session } from '$lib/state/session.svelte';
import { signedInSession } from '$lib/testing/fixtures';
import { APP_VERSION } from '$lib/version';
import { DRAWER_ID } from './MenuFab.svelte';
import SideNav from './SideNav.svelte';

const DESTINATIONS = ['Today', 'Progress', 'Exercise', 'Plan', 'You'];

const SESSION = signedInSession(new Date(Date.now() + 86_400_000).toISOString());

beforeEach(() => {
	localStorage.clear();
	session.current = null;
	session.hydrated = false;
});

describe('SideNav', () => {
	it('stays out of the way while closed', async () => {
		await render(SideNav, { props: { open: false, pathname: '/' } });
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it('offers every destination when open', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		for (const label of DESTINATIONS) {
			await expect.element(page.getByRole('link', { name: label })).toBeInTheDocument();
		}
	});

	it('carries the exercise destination', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect
			.element(page.getByRole('link', { name: 'Exercise' }))
			.toHaveAttribute('href', '/exercise');
	});

	it('names itself for screen readers', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect.element(page.getByRole('dialog', { name: 'Fit_' })).toBeInTheDocument();
	});

	it('marks the current destination for assistive technology', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect
			.element(page.getByRole('link', { name: 'Today' }))
			.toHaveAttribute('aria-current', 'page');
	});

	it('leaves the other destinations unmarked', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
	});

	it('highlights whichever destination is current', async () => {
		await render(SideNav, { props: { open: true, pathname: '/exercise' } });
		await expect.element(page.getByRole('link', { name: 'Exercise' })).toHaveClass(/text-primary/);
	});

	it('marks nothing current on an unknown path', async () => {
		await render(SideNav, { props: { open: true, pathname: '/nowhere' } });
		expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
	});

	it('moves the current marker when navigation happens', async () => {
		const props = $state({ open: true, pathname: '/' });
		await render(SideNav, { props });
		props.pathname = '/plan';
		await expect
			.element(page.getByRole('link', { name: 'Plan' }))
			.toHaveAttribute('aria-current', 'page');
		expect(document.querySelector('a[href$="/"]')?.getAttribute('aria-current')).toBeNull();
	});

	// The drawer carries no close button of its own since the menu became a
	// floating toggle (`MenuFab`): that toggle stays on screen above this panel
	// wearing an X, and it is the close control. A second button with the same
	// name inside here would only make a screen reader ask which one it meant.
	it('offers no close button of its own, because the toggle outside is the one', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		expect(page.getByRole('button', { name: 'Close menu' }).elements()).toHaveLength(0);
	});

	it('answers to the name the toggle points at', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect.element(page.getByRole('dialog')).toHaveAttribute('id', DRAWER_ID);
	});

	// The toggle floats above this drawer's overlay, so `bits-ui` reads a tap on
	// it as an outside interaction and would close on `pointerdown` — leaving the
	// toggle's own click to reopen what had just shut. The drawer declines, and
	// every other outside tap still closes it.
	// Whether a tap on the floating toggle closes this drawer, and whether a tap
	// anywhere else still does, is decided by real pointer events against a real
	// stylesheet — the drawer only treats an interaction as "outside" after
	// measuring where it landed relative to this panel, and this project renders
	// components with no stylesheet to measure against. Both are asserted end to
	// end in `menu-toggle.e2e.ts`.

	it('carries the account block, which is where signing out lives', async () => {
		// The drawer is inside the gate, so there is always somebody signed in to
		// name here: a visitor without a session never reaches a screen with a
		// drawer on it.
		session.begin(SESSION);
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect.element(page.getByText('@robin', { exact: true })).toBeInTheDocument();
	});

	it('offers the sign-out to someone who is signed in', async () => {
		session.begin(SESSION);
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect
			.element(page.getByRole('button', { name: 'Sign out', exact: true }))
			.toBeInTheDocument();
	});

	it('shows which build this is, at the foot of the drawer', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect.element(page.getByText(APP_VERSION, { exact: true })).toBeInTheDocument();
	});

	it('names the number for a screen reader rather than showing a bare string', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		await expect.element(page.getByText(`Version ${APP_VERSION}`)).toBeInTheDocument();
	});

	it('offers nothing to tap: the version is text, not a control', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		const shown = [...document.querySelectorAll('span')].find(
			(element) => element.textContent === APP_VERSION
		);
		expect(shown?.closest('a, button')).toBeNull();
	});

	// The click puts the pointer inside the drawer before the key goes out, and
	// it names what it is aiming at. Clicking the dialog itself aimed at the
	// panel's geometric centre, and what sits at that point depends on the
	// viewport and on how tall the account block has rendered by then — on CI it
	// landed on the third destination and really navigated the test iframe to
	// /exercise, which ends the browser session and takes every spec file behind
	// this one with it.
	const INERT_SURFACE = 'Everything stays on this device.';

	it('keeps that surface inert: it is text, and no destination sits on it', async () => {
		await render(SideNav, { props: { open: true, pathname: '/' } });
		const surface = [...document.querySelectorAll('*')].find(
			(element) => element.textContent === INERT_SURFACE
		);
		expect(surface?.closest('a, button')).toBeNull();
	});

	it('closes on Escape', async () => {
		const props = $state({ open: true, pathname: '/' });
		await render(SideNav, { props });
		await page.getByText(INERT_SURFACE, { exact: true }).click();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(props.open).toBe(false);
	});
});
