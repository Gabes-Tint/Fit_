import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { emptyProfile } from '$lib/domain/profile';
import { logUi } from '$lib/state/log-ui.svelte';
import { session, SESSION_STORAGE_KEY } from '$lib/state/session.svelte';
import { sync } from '$lib/state/sync.svelte';
import { STORAGE_KEY, tend } from '$lib/state/tend.svelte';
import { signedInSession } from '$lib/testing/fixtures';
import AppShellHarness from './AppShellHarness.svelte';

const goto = vi.hoisted(() => vi.fn());
// `afterNavigate` is mocked beside it: same module, and a partial mock leaves the other undefined.
vi.mock('$app/navigation', () => ({ goto, afterNavigate: () => {} }));

/** Where the shell thinks it is; both of the gate's decisions are functions of it. */
const location = vi.hoisted(() => ({ current: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return location.current;
		}
	}
}));

function at(path: string) {
	location.current = new URL(path, 'http://localhost');
}

/** Put a completed onboarding into storage, the way a returning visit would find it. */
function seedOnboardedStorage() {
	const store = { onboarded: true, activeProfileId: 'p1', profiles: [], weekPlan: [], pantry: [] };
	store.profiles = [{ ...emptyProfile({ name: 'Alex' }), id: 'p1' }] as never;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** A session record of the shape signing in leaves behind, still in date. */
function seedSessionStorage({ expiresInMs = 90 * 24 * 60 * 60 * 1000 } = {}) {
	const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
	localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(signedInSession(expiresAt)));
}

/** Signed in and past onboarding: what most of these tests are about is what follows. */
function seedReturningVisit() {
	seedOnboardedStorage();
	seedSessionStorage();
}

/** Keep a test from reaching a real endpoint. */
function stubFetch() {
	return vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation(() => Promise.resolve(new Response(null, { status: 401 })));
}

/**
 * A `/api/state` request that hangs until released, answering with the given
 * document once it is. Anything else — the session refresh `AppShell` fires on
 * mount among it — is refused with a dropped connection, the same default the
 * outer `beforeEach` sets up, so a held read is the only thing about the
 * exchange this changes.
 */
function heldStateFetch() {
	let release: (response: Response) => void = () => {};
	const answered = new Promise<Response>((resolve) => {
		release = resolve;
	});
	vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
		// Every call in this app passes a string path, `resolve()`'s own return
		// type; anything else is not a request this held mock recognizes.
		const url = typeof input === 'string' ? input : '';
		if (url.includes('/api/state')) return answered;
		return Promise.reject(new TypeError('Failed to fetch'));
	});
	return {
		release: (version: number, body: Record<string, unknown> | null) =>
			release(
				new Response(JSON.stringify({ version, format: 'tend.v1', body, updatedAt: null }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
	};
}

beforeEach(() => {
	goto.mockClear();
	at('/');
	localStorage.clear();
	logUi.open = false;
	logUi.tab = 'type';
	// A module singleton like the two below: left running, it would keep watching
	// the store and answering the next test's stubbed fetch.
	sync.stop();
	tend.resetAll();
	tend.hydrated = false;
	// The session store is a module singleton, so a previous render's hydration
	// would otherwise make this one a no-op.
	session.current = null;
	session.hydrated = false;
	// A seeded session is reconciled against the server on mount, and an answer
	// of "no such session" would sign the device out mid-test and gate the very
	// page under assertion. A dropped request is the one answer that changes
	// nothing, so it is the default here; tests about the request say otherwise.
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('AppShell, before anyone has signed in', () => {
	it('sends an unauthenticated visitor to the sign-in form', async () => {
		seedOnboardedStorage();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/signin', { replaceState: true }));
	});

	it('shows them no page while it goes', async () => {
		seedOnboardedStorage();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		expect(document.body.textContent).not.toContain('Page body');
	});

	it('shows them no menu to open either', async () => {
		seedOnboardedStorage();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		expect(page.getByRole('button', { name: 'Open menu' }).elements()).toHaveLength(0);
	});

	it('gates onboarding too, so a first visit signs in first', async () => {
		// Nothing is seeded: this is a device that has never been used. Onboarding
		// is a feature like any other, and it comes after the account.
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());
		expect(document.body.textContent).not.toContain('A quieter tracker');
	});

	it('names the page they asked for, so signing in lands there', async () => {
		seedOnboardedStorage();
		at('/exercise/session');
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() =>
			expect(goto).toHaveBeenCalledWith(`/signin?next=${encodeURIComponent('/exercise/session')}`, {
				replaceState: true
			})
		);
	});

	it('carries the query with it, because the page is that whole address', async () => {
		seedOnboardedStorage();
		at('/exercise/routines/r-1?edit=1');
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() =>
			expect(goto).toHaveBeenCalledWith(
				`/signin?next=${encodeURIComponent('/exercise/routines/r-1?edit=1')}`,
				{ replaceState: true }
			)
		);
	});

	it('keeps the fragment, which is the part of a link easiest to lose', async () => {
		seedOnboardedStorage();
		at('/exercise/session#set-3');
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() =>
			expect(goto).toHaveBeenCalledWith(
				`/signin?next=${encodeURIComponent('/exercise/session#set-3')}`,
				{ replaceState: true }
			)
		);
	});

	it('asks nothing on behalf of a device that was never signed in', async () => {
		seedOnboardedStorage();
		const fetched = stubFetch();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());
		expect(fetched).not.toHaveBeenCalled();
	});
});

describe('AppShell, on the sign-in form itself', () => {
	it('renders the form rather than redirecting to it', async () => {
		at('/signin');
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await expect.element(page.getByText('Page body')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});

	it('gives it no chrome, so there is no drawer to open', async () => {
		at('/signin');
		await render(AppShellHarness, { props: { body: 'Page body' } });
		expect(page.getByRole('button', { name: 'Open menu' }).elements()).toHaveLength(0);
	});

	it('lets an unauthenticated visitor reach the sign-up form too', async () => {
		at('/signup');
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await expect.element(page.getByText('Page body')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});
});

describe('AppShell, signed in', () => {
	it('shows onboarding to someone who has not onboarded', async () => {
		seedSessionStorage();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await expect.element(page.getByText('A quieter tracker')).toBeInTheDocument();
	});

	it('shows a loading state instead of onboarding while a fresh device is still pulling', async () => {
		// No document on this device: `tend.state.onboarded` reads `false` exactly
		// as it would for someone who has genuinely never used the app, so the
		// held read is what stands between the two, not local storage.
		seedSessionStorage();
		const state = heldStateFetch();
		await render(AppShellHarness, { props: { body: 'Page body' } });

		await expect.element(page.getByText('Loading your data…')).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('A quieter tracker');

		state.release(0, null);
		await expect.element(page.getByText('A quieter tracker')).toBeInTheDocument();
	});

	it('lands on the pulled document rather than onboarding, once the pull settles', async () => {
		// The server holds an onboarded household this device has never seen.
		// Onboarding must never appear even for the one tick before the document
		// lands — this is the disorienting flash the issue is about.
		seedSessionStorage();
		const state = heldStateFetch();
		await render(AppShellHarness, { props: { body: 'Page body' } });

		state.release(3, {
			onboarded: true,
			activeProfileId: 'p1',
			profiles: [],
			weekPlan: [],
			pantry: []
		});

		await expect.element(page.getByText('Page body')).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('A quieter tracker');
	});

	it('lets a person continue past a stuck pull rather than holding them with no way forward', async () => {
		seedSessionStorage();
		// Held rather than released for most of the test — the stuck-connection
		// case — but resolved before the test ends so no unsettled request is
		// left running against the shared `sync` singleton for a later test.
		const state = heldStateFetch();
		vi.useFakeTimers();
		await render(AppShellHarness, { props: { body: 'Page body' } });

		await vi.advanceTimersByTimeAsync(6000);
		await page.getByRole('button', { name: 'Continue without waiting' }).click();
		vi.useRealTimers();

		// Nothing pulled and no local document either: this is the same
		// Onboarding a device that had never synced would have shown, which is
		// what "continuing" means here — not a promise the pull is abandoned.
		await expect.element(page.getByText('A quieter tracker')).toBeInTheDocument();

		state.release(0, null);
	});

	it('does not hold a returning device with its own document behind a spinner', async () => {
		// This device already has its own onboarded document; the quiet
		// background refresh a returning visit gets must not be interrupted by
		// the loading screen meant for a device with nothing of its own.
		seedReturningVisit();
		const state = heldStateFetch();
		await render(AppShellHarness, { props: { body: 'Page body' } });

		await expect.element(page.getByText('Page body')).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('Loading your data…');
		state.release(0, null);
	});

	it('does not show the page content during onboarding', async () => {
		seedSessionStorage();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		expect(document.body.textContent).not.toContain('Page body');
	});

	it('shows the page to someone who has onboarded', async () => {
		seedReturningVisit();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await expect.element(page.getByText('Page body')).toBeInTheDocument();
	});

	it('keeps the navigation behind the menu button until it is asked for', async () => {
		seedReturningVisit();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await expect.element(page.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it('offers the five navigation destinations once the menu is open', async () => {
		seedReturningVisit();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await page.getByRole('button', { name: 'Open menu' }).click();
		for (const label of ['Today', 'Progress', 'Exercise', 'Plan', 'You']) {
			await expect.element(page.getByRole('link', { name: label })).toBeInTheDocument();
		}
	});

	it('closes the menu again from its close control', async () => {
		seedReturningVisit();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('button', { name: 'Close menu' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	// Current-destination highlighting depends on real routing, so it is asserted end to end.

	// The shell itself no longer carries a way to open the log sheet — that
	// moved onto the Today page's own cards (#today-card-actions) when the
	// floating `LogFab` button was removed. Opening the sheet is covered where
	// a button for it now actually lives: `TodayView.svelte.spec.ts` and
	// `today-card-actions.e2e.ts`.

	it('closes the app the moment the session expires under it', async () => {
		// The gate compares the expiry against a wall clock, and a clock is not
		// reactive: without something waiting for the moment, a tab open past it
		// keeps rendering the whole app on the wrong side of the gate.
		vi.useFakeTimers();
		try {
			seedOnboardedStorage();
			seedSessionStorage({ expiresInMs: 60_000 });
			await render(AppShellHarness, { props: { body: 'Page body' } });
			await vi.waitFor(() => expect(document.body.textContent).toContain('Page body'));

			await vi.advanceTimersByTimeAsync(61_000);

			expect(session.signedIn).toBe(false);
			expect(goto).toHaveBeenCalledWith('/signin', { replaceState: true });
		} finally {
			vi.useRealTimers();
		}
	});

	it('waits for an expiry further off than one timer can hold', async () => {
		// `setTimeout` overflows past about twenty-five days and fires at once, so
		// a ninety-day session scheduled in one go would sign the device out
		// immediately. The wait is taken a day at a time instead.
		vi.useFakeTimers();
		try {
			seedOnboardedStorage();
			seedSessionStorage({ expiresInMs: 90 * 24 * 60 * 60 * 1000 });
			await render(AppShellHarness, { props: { body: 'Page body' } });
			await vi.waitFor(() => expect(document.body.textContent).toContain('Page body'));

			await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);

			expect(session.signedIn).toBe(true);
			expect(goto).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('reconciles a restored session against the server it was issued by', async () => {
		// The restored session may have been revoked elsewhere; only the server knows.
		seedReturningVisit();
		const fetched = stubFetch();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() => expect(fetched).toHaveBeenCalled());
		expect(fetched).toHaveBeenCalledWith('/api/sessions/current', { method: 'GET' });
	});

	it('gates the page again once the server says the session is gone', async () => {
		// A revoked session is not a display detail: what it was holding open was
		// the whole journal, so the shell has to close it again.
		seedReturningVisit();
		stubFetch();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/signin', { replaceState: true }));
	});
});

describe('AppShell and the household document', () => {
	/** Every path a request took, so one endpoint can be picked out of the rest. */
	function fetchedPaths(): string[] {
		return vi
			.mocked(globalThis.fetch)
			.mock.calls.map(([input]) => (typeof input === 'string' ? input : ''));
	}

	it('asks for the household’s document once there is a session to ask with', async () => {
		seedReturningVisit();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() => expect(fetchedPaths()).toContain('/api/state'));
	});

	it('asks for nothing before anyone has signed in', async () => {
		seedOnboardedStorage();
		await render(AppShellHarness, { props: { body: 'Page body' } });
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());
		expect(fetchedPaths()).not.toContain('/api/state');
	});
});
