import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignedInSession } from '$lib/auth/api';
import { jsonResponse } from '$lib/testing/fixtures';
import { isSession, session, SESSION_STORAGE_KEY, SessionStore } from './session.svelte';

const DAY_MS = 24 * 60 * 60 * 1000;

// Kept local rather than pointed at `$lib/testing/fixtures`' `signedInSession`: this one
// needs two households (the drawer this module feeds has to pick among them), where the
// shared fixture deliberately has one.
function signedInSession(expiresAt: string): SignedInSession {
	return {
		account: { id: 'a-1', username: 'robin', displayName: 'Robin', createdAt: '2026-08-01' },
		households: [
			{ householdId: 'h-1', name: 'Home', role: 'owner' },
			{ householdId: 'h-2', name: 'Cabin', role: 'member' }
		],
		expiresAt
	};
}

function inDays(days: number): string {
	return new Date(Date.now() + days * DAY_MS).toISOString();
}

beforeEach(() => {
	localStorage.clear();
	session.current = null;
	session.hydrated = false;
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// Tests which answers `refresh` believes, not the endpoint.
function stubFetch(response: Response | Error): void {
	vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
		response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
	);
}

describe('session', () => {
	it('starts knowing nothing', () => {
		expect(session.signedIn).toBe(false);
	});

	it('has no account to name before anyone signs in', () => {
		expect(session.account).toBeNull();
	});

	it('has no household to name before anyone signs in', () => {
		expect(session.household).toBeNull();
	});

	it('holds the account a sign-in handed back', () => {
		session.begin(signedInSession(inDays(90)));
		expect(session.account?.displayName).toBe('Robin');
	});

	it('names the first household, which is the one the account owns', () => {
		session.begin(signedInSession(inDays(90)));
		expect(session.household?.name).toBe('Home');
	});

	it('reads as signed in while the session has time left', () => {
		session.begin(signedInSession(inDays(90)));
		expect(session.signedIn).toBe(true);
	});

	it('reads as signed out once the expiry has passed', () => {
		session.begin(signedInSession(inDays(-1)));
		expect(session.signedIn).toBe(false);
	});

	it('survives a reload', () => {
		session.begin(signedInSession(inDays(90)));
		session.current = null;
		session.hydrated = false;
		session.hydrate();
		expect(session.account?.username).toBe('robin');
	});

	it('never writes a token, because the browser was never given one', () => {
		session.begin(signedInSession(inDays(90)));
		expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toContain('token');
	});

	it('drops an expired record on the way in rather than naming a dead session', () => {
		localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(signedInSession(inDays(-1))));
		session.hydrate();
		expect(session.current).toBeNull();
	});

	it('clears the storage an expired record was read from', () => {
		localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(signedInSession(inDays(-1))));
		session.hydrate();
		expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});

	it('reads a corrupt payload as signed out rather than throwing', () => {
		localStorage.setItem(SESSION_STORAGE_KEY, '{not json');
		session.hydrate();
		expect(session.signedIn).toBe(false);
	});

	it('rejects a payload that is not a session at all', () => {
		localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ account: 'robin' }));
		session.hydrate();
		expect(session.current).toBeNull();
	});

	it('is hydrated even when there was nothing to restore', () => {
		session.hydrate();
		expect(session.hydrated).toBe(true);
	});

	it('does not read storage a second time', () => {
		session.hydrate();
		localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(signedInSession(inDays(90))));
		session.hydrate();
		expect(session.current).toBeNull();
	});

	it('forgets the account when the session ends', () => {
		session.begin(signedInSession(inDays(90)));
		session.forget();
		expect(session.signedIn).toBe(false);
	});

	it('leaves nothing in storage when the session ends', () => {
		session.begin(signedInSession(inDays(90)));
		session.forget();
		expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});

	it('takes the session the server reports over the one it remembered', async () => {
		session.begin(signedInSession(inDays(90)));
		const renewed = signedInSession(inDays(30));
		stubFetch(jsonResponse(renewed));
		await expect(session.refresh()).resolves.toBe(true);
		expect(session.current).toEqual(renewed);
	});

	it('stores what the server reported, so the next reload starts from it', async () => {
		stubFetch(jsonResponse(signedInSession(inDays(30))));
		await session.refresh();
		expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain('robin');
	});

	it('signs the device out when the server says there is no session', async () => {
		session.begin(signedInSession(inDays(90)));
		stubFetch(jsonResponse({ error: { code: 'unauthenticated' } }, { status: 401 }));
		await expect(session.refresh()).resolves.toBe(false);
		expect(session.signedIn).toBe(false);
		expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});

	it('keeps a session that began while the refusal was still in flight', async () => {
		// The sign-in form asks this on mount, and the visitor may sign in before
		// the answer lands — a password manager filling and submitting is enough.
		// The 401 is then news about the nothing that was there when it was asked,
		// not about the session that arrived since, and acting on it signed the
		// device straight back out of the account it had just signed into.
		stubFetch(jsonResponse({ error: { code: 'unauthenticated' } }, { status: 401 }));
		const asking = session.refresh();
		const fresh = signedInSession(inDays(90));
		session.begin(fresh);
		await expect(asking).resolves.toBe(false);
		expect(session.current).toEqual(fresh);
		expect(session.signedIn).toBe(true);
	});

	it('keeps the record when the request never arrived, rather than guessing', async () => {
		// Offline is not signed out: dropping the record would sign out a working session.
		session.begin(signedInSession(inDays(90)));
		stubFetch(new TypeError('Failed to fetch'));
		await expect(session.refresh()).resolves.toBe(false);
		expect(session.signedIn).toBe(true);
		expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain('robin');
	});
});

describe('SESSION_STORAGE_KEY', () => {
	it('is the key already in the browsers that have it', () => {
		// Renaming this signs out every device holding the old key: the name is a contract.
		expect(SESSION_STORAGE_KEY).toBe('fit.session.v1');
	});
});

describe('a fresh store', () => {
	it('has not read storage yet', () => {
		expect(new SessionStore().hydrated).toBe(false);
	});

	it('knows nobody until something tells it', () => {
		expect(new SessionStore().current).toBeNull();
	});

	it('reads a session that expires this very instant as over', () => {
		// `expiresAt` is when the server stops honouring it, so the boundary is expired.
		const now = Date.parse('2026-08-30T12:00:00.000Z');
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const store = new SessionStore();
		store.begin(signedInSession(new Date(now).toISOString()));
		expect(store.signedIn).toBe(false);
	});

	it('leaves storage alone when there was nothing to restore', () => {
		// Hydrating an empty browser must not look like a sign-out.
		const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
		new SessionStore().hydrate();
		expect(removeItem).not.toHaveBeenCalled();
	});
});

describe('a browser with no localStorage', () => {
	// Capacitor WebView and blocked site data both reach this with `localStorage` missing; nothing may throw.
	beforeEach(() => {
		vi.stubGlobal('localStorage', undefined);
	});

	it('still records the session a sign-in handed back', () => {
		const store = new SessionStore();
		const value = signedInSession(inDays(90));
		store.begin(value);
		expect(store.current).toEqual(value);
	});

	it('still forgets the session', () => {
		const store = new SessionStore();
		store.begin(signedInSession(inDays(90)));
		store.forget();
		expect(store.current).toBeNull();
	});

	it('hydrates to nobody rather than throwing', () => {
		const store = new SessionStore();
		store.hydrate();
		expect(store.current).toBeNull();
	});
});

describe('isSession', () => {
	function payload(overrides: Record<string, unknown>): Record<string, unknown> {
		return {
			expiresAt: inDays(90),
			households: [],
			account: { displayName: 'Robin', username: 'robin' },
			...overrides
		};
	}

	it('accepts what the endpoints hand back', () => {
		expect(isSession(payload({}))).toBe(true);
	});

	it('rejects nothing at all', () => {
		expect(isSession(null)).toBe(false);
	});

	it('rejects a payload that is not an object', () => {
		expect(isSession(5)).toBe(false);
	});

	it('rejects text where a session was stored', () => {
		expect(isSession('robin')).toBe(false);
	});

	it('rejects a function wearing a session\u2019s properties, because it is not one', () => {
		// The type guard must reject non-objects regardless of their properties.
		const impostor = Object.assign(() => undefined, payload({}));
		expect(isSession(impostor)).toBe(false);
	});

	it('rejects a session with no expiry, which could never be read as over', () => {
		expect(isSession(payload({ expiresAt: undefined }))).toBe(false);
	});

	it('rejects households that are not a list, which the drawer indexes into', () => {
		expect(isSession(payload({ households: 'Home' }))).toBe(false);
	});

	it('rejects a payload with no account on it', () => {
		expect(isSession(payload({ account: undefined }))).toBe(false);
	});

	it('rejects an account with no name to show', () => {
		expect(isSession(payload({ account: { username: 'robin' } }))).toBe(false);
	});

	it('rejects an account with no username', () => {
		expect(isSession(payload({ account: { displayName: 'Robin' } }))).toBe(false);
	});
});
