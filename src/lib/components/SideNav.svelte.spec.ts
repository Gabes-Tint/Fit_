import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { session } from '$lib/state/session.svelte';
import { signedInSession } from '$lib/testing/fixtures';
import { APP_VERSION } from '$lib/version';
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

	it('closes from its close control', async () => {
		const props = $state({ open: true, pathname: '/' });
		await render(SideNav, { props });
		await page.getByRole('button', { name: 'Close menu' }).click();
		expect(props.open).toBe(false);
	});

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

	it('closes on Escape', async () => {
		const props = $state({ open: true, pathname: '/' });
		await render(SideNav, { props });
		await page.getByRole('dialog').click();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(props.open).toBe(false);
	});
});
