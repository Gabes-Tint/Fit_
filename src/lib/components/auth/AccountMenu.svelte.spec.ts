import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { session } from '$lib/state/session.svelte';
import { sync, SYNC_STORAGE_KEY } from '$lib/state/sync.svelte';
import { STORAGE_KEY, tend } from '$lib/state/tend.svelte';
import { signedInSession } from '$lib/testing/fixtures';
import AccountMenu from './AccountMenu.svelte';

type Sent = { path: string; method: string | undefined };

function pathOf(input: string | URL | Request): string {
	if (typeof input === 'string') return input;
	return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function answer(status: number, body: unknown = null): Sent[] {
	const sent: Sent[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
		sent.push({ path: pathOf(input), method: init?.method });
		return Promise.resolve(
			body === null
				? new Response(null, { status })
				: new Response(JSON.stringify(body), {
						status,
						headers: { 'content-type': 'application/json' }
					})
		);
	});
	return sent;
}

const SESSION = signedInSession();

function signedIn() {
	session.begin(SESSION);
}

beforeEach(() => {
	sync.stop();
	tend.clear();
	localStorage.clear();
	session.current = null;
	session.hydrated = false;
});

afterEach(() => {
	sync.stop();
	vi.restoreAllMocks();
});

/**
 * A device holding a change the server has never taken: it has a document of
 * its own, and every request it makes is dropped.
 */
async function withUnsentChanges() {
	tend.hydrate();
	tend.togglePantry('oats');
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
	await sync.start('h-1');
	vi.restoreAllMocks();
}

/**
 * There is no signed-out half to test: the drawer lives inside the gate, so a
 * visitor without a session never reaches a screen that renders one. What
 * happens to them instead belongs to `AppShell.svelte.spec.ts`.
 */
describe('AccountMenu', () => {
	it('names who is signed in', async () => {
		signedIn();
		await render(AccountMenu);
		await expect.element(page.getByText('Robin', { exact: true })).toBeInTheDocument();
	});

	it('shows only the username, not the household it is filtered by', async () => {
		signedIn();
		await render(AccountMenu);
		await expect.element(page.getByText('@robin', { exact: true })).toBeInTheDocument();
	});

	it('ends this device’s session at the current-session endpoint', async () => {
		signedIn();
		const sent = answer(204);
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await vi.waitFor(() =>
			expect(sent[0]).toEqual({ path: '/api/sessions/current', method: 'DELETE' })
		);
	});

	it('forgets the account once the server has answered', async () => {
		signedIn();
		answer(204);
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await vi.waitFor(() => expect(session.signedIn).toBe(false));
	});

	it('ends every session at the collection endpoint', async () => {
		signedIn();
		const sent = answer(204);
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out everywhere' }).click();
		await vi.waitFor(() => expect(sent[0]).toEqual({ path: '/api/sessions', method: 'DELETE' }));
	});

	it('forgets the account after signing out everywhere', async () => {
		signedIn();
		answer(204);
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out everywhere' }).click();
		await vi.waitFor(() => expect(session.signedIn).toBe(false));
	});

	it('forgets a session the server says it never had', async () => {
		signedIn();
		answer(401, { error: { code: 'unauthenticated' } });
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out everywhere' }).click();
		await vi.waitFor(() => expect(session.signedIn).toBe(false));
	});

	it('asks before dropping a change the server has never taken', async () => {
		signedIn();
		await withUnsentChanges();
		answer(204);
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect
			.element(page.getByText('Some of what you logged has not reached the server yet.'))
			.toBeInTheDocument();
		expect(session.signedIn).toBe(true);
	});

	it('signs out anyway once the person says so', async () => {
		signedIn();
		await withUnsentChanges();
		answer(204);
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await page.getByRole('button', { name: 'Sign out anyway' }).click();
		await vi.waitFor(() => expect(session.signedIn).toBe(false));
	});

	it('goes back to offering the sign-out when the person keeps the changes', async () => {
		signedIn();
		await withUnsentChanges();
		answer(204);
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await page.getByRole('button', { name: 'Keep them' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Sign out', exact: true }))
			.toBeInTheDocument();
		expect(session.signedIn).toBe(true);
	});

	it('leaves neither the journal nor the sync record behind', async () => {
		signedIn();
		answer(204);
		tend.hydrate();
		tend.togglePantry('oats');
		localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ householdId: 'h-1', version: 1 }));
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await vi.waitFor(() => expect(session.signedIn).toBe(false));
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(localStorage.getItem(SYNC_STORAGE_KEY)).toBeNull();
	});

	it('keeps the record when nothing was asked and nothing answered', async () => {
		signedIn();
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
		await render(AccountMenu);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect.element(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
		expect(session.signedIn).toBe(true);
	});
});
