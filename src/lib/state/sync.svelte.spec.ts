import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '$lib/domain/profile';
import type { TendState } from '$lib/domain/types';
import { OUTDATED_MESSAGE, SCHEMA_VERSION } from '$lib/domain/state-document';
import { REFUSED_STORAGE_KEY, STORAGE_KEY, TendStore } from './tend.svelte';
import { fingerprint } from './outstanding-write';
import { SYNC_STORAGE_KEY, SyncStore, type SyncRecord } from './sync.svelte';

const announced = vi.hoisted(() => [] as string[]);
vi.mock('$lib/ui/toast.svelte', () => ({
	toast: (message: string) => {
		announced.push(message);
	}
}));

const HOUSEHOLD = 'h-1';

type Sent = {
	path: string;
	method: string | undefined;
	contentType: string | undefined;
	body: Record<string, unknown> | null;
};

// Local, not `$lib/testing/fixtures`' `jsonResponse`: every call site below passes `status`
// as a bare second argument (`jsonResponse(body, 409)`), not an `init` bag, so this stays.
function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/** What a read answers, and what a refused write answers: the same four fields. */
function documentAnswer(version: number, body: Record<string, unknown> | null): Response {
	return jsonResponse({ version, format: 'tend.v1', body, updatedAt: null });
}

function stale(version: number, body: Record<string, unknown> | null): Response {
	return jsonResponse({ error: { code: 'stale-version' }, version, format: 'tend.v1', body }, 409);
}

function stored(version: number): Response {
	return jsonResponse({ version, updatedAt: '2026-09-04T09:00:00.000Z' });
}

const DROPPED = new TypeError('Failed to fetch');

/** What one request asked, in the shape the assertions below read. */
function noteCall(sent: Sent[], input: RequestInfo | URL, init: RequestInit | undefined): Sent {
	const raw = init?.body;
	const call: Sent = {
		path: typeof input === 'string' ? input : '',
		method: init?.method,
		contentType: (init?.headers as Record<string, string> | undefined)?.['content-type'],
		body: typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : null
	};
	sent.push(call);
	return call;
}

/** A server that answers the given sequence, and records what it was asked. */
function server(answers: (Response | Error)[]): Sent[] {
	const sent: Sent[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
		noteCall(sent, input, init);
		const next = answers.shift();
		if (next === undefined) return Promise.reject(new Error('the server was asked once too often'));
		return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
	});
	return sent;
}

/**
 * The name the device would have given the document a request carried, which is
 * what its record should be holding while that request goes unanswered.
 */
function carried(call: Sent | undefined): string {
	return fingerprint((call?.body as { body: object }).body);
}

function record(): SyncRecord | null {
	const raw = localStorage.getItem(SYNC_STORAGE_KEY);
	return raw === null ? null : (JSON.parse(raw) as SyncRecord);
}

/** A device that has recorded something of its own. */
function journal(): TendStore {
	const store = new TendStore();
	store.hydrate();
	store.state.profiles.push(emptyProfile({ name: 'Alex' }));
	store.persist();
	return store;
}

/** A device that has never written anything down. */
function blankDevice(): TendStore {
	const store = new TendStore();
	store.hydrate();
	return store;
}

function remoteState(name: string): Record<string, unknown> {
	const profile = { ...emptyProfile({ name }), id: 'p-remote' };
	return { onboarded: true, activeProfileId: 'p-remote', profiles: [profile] };
}

function deferred(): { promise: Promise<void>; release: () => void } {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

const running: SyncStore[] = [];

function syncFor(store: TendStore): SyncStore {
	const sync = new SyncStore(store);
	running.push(sync);
	return sync;
}

beforeEach(() => {
	localStorage.clear();
	announced.length = 0;
});

afterEach(() => {
	for (const sync of running.splice(0)) sync.stop();
	vi.restoreAllMocks();
});

describe('the first sync a device does', () => {
	// The literal, not the constant: a renamed key would round-trip against itself.
	it('keeps its record under the key the rest of the application knows', () => {
		expect(SYNC_STORAGE_KEY).toBe('tend.sync.v1');
	});

	it('talks to the one endpoint that holds the document, and reads with a GET', async () => {
		const sent = server([documentAnswer(0, null)]);
		const sync = syncFor(blankDevice());

		await sync.start(HOUSEHOLD);

		expect(sent[0]).toMatchObject({ path: '/api/state', method: 'GET' });
	});

	it('declares JSON on the write, which is all the endpoint accepts', async () => {
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(journal());

		await sync.start(HOUSEHOLD);

		expect(sent[1]?.contentType).toBe('application/json');
	});

	it('knows nothing before it starts', () => {
		const sync = syncFor(blankDevice());
		expect(sync.status).toBe('idle');
		expect(sync.version).toBe(0);
	});

	it('sends a journal the server has never seen, rather than being emptied by it', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sent[1]?.method).toBe('PUT');
		expect(store.state.profiles).toHaveLength(1);
	});

	it('records the version the first write created', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sync.version).toBe(1);
		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 1,
			dirty: false,
			outstanding: null
		});
	});

	it('reads once and writes once, and then stops talking', async () => {
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(journal());

		await sync.start(HOUSEHOLD);

		expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT']);
	});

	it('sends the whole document, onboarding flag and active profile included', async () => {
		const store = journal();
		store.state.onboarded = true;
		store.state.activeProfileId = 'p-1';
		store.persist();
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		const body = sent[1]?.body as { format: string; body: TendState } | undefined;
		expect(body?.format).toBe('tend.v4');
		expect(body?.body.onboarded).toBe(true);
		expect(body?.body.activeProfileId).toBe('p-1');
	});

	it('asks a server with nothing for nothing, when the device has nothing either', async () => {
		const sent = server([documentAnswer(0, null)]);
		const sync = syncFor(blankDevice());

		await sync.start(HOUSEHOLD);

		expect(sent).toHaveLength(1);
		expect(sync.status).toBe('idle');
	});

	it('takes the account’s document onto a device that has none of its own', async () => {
		const store = blankDevice();
		server([documentAnswer(3, remoteState('Robin'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles[0]?.name).toBe('Robin');
		expect(sync.version).toBe(3);
	});

	it('says nothing to someone opening the app on a new device', async () => {
		server([documentAnswer(3, remoteState('Robin'))]);
		const sync = syncFor(blankDevice());

		await sync.start(HOUSEHOLD);

		expect(announced).toEqual([]);
		expect(sync.status).toBe('idle');
	});

	it('fills in a field an older document never had', async () => {
		const store = blankDevice();
		server([documentAnswer(3, { onboarded: true })]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.routines).toEqual([]);
	});
});

describe('an answer that cannot be read', () => {
	it('is not mistaken for a document, when it is not an object at all', async () => {
		const store = journal();
		server([jsonResponse(null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('error');
		expect(store.state.profiles).toHaveLength(1);
	});

	it('is not mistaken for a document, when the body is not an object', async () => {
		const store = journal();
		server([jsonResponse({ version: 4, format: 'tend.v1', body: 'nonsense' }), stored(5)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles).toHaveLength(1);
		expect(sync.version).toBe(5);
	});

	it('is not mistaken for a document, when the body is an array', async () => {
		const store = journal();
		server([jsonResponse({ version: 4, format: 'tend.v1', body: [] }), stored(5)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		// An unusable body reads as "nothing stored here", which is the one case
		// where this device's own document wins.
		expect(store.state.profiles).toHaveLength(1);
		expect(sync.version).toBe(5);
	});

	it('is not mistaken for a document, when the version is not a whole number', async () => {
		const store = journal();
		server([jsonResponse({ version: 1.5, format: 'tend.v1', body: remoteState('Robin') })]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('error');
		expect(store.state.profiles[0]?.name).toBe('Alex');
	});

	it('leaves a write unsent when the answer names no version', async () => {
		const store = journal();
		server([documentAnswer(0, null), jsonResponse({ updatedAt: 'now' })]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(record()?.dirty).toBe(true);
		expect(sync.status).toBe('error');
	});

	it('adopts nothing from a refusal that carries no readable document', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 3, dirty: true })
		);
		server([
			documentAnswer(3, remoteState('Alex')),
			jsonResponse({ error: { code: 'stale-version' } }, 409)
		]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('error');
		expect(record()?.dirty).toBe(true);
		expect(sync.version).toBe(3);
	});
});

describe('a device that belonged to someone else', () => {
	it('is emptied before the new household is read', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: 'h-other', version: 4, dirty: false })
		);
		server([documentAnswer(0, null)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles).toEqual([]);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('never pushes the old household’s journal to the new one', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: 'h-other', version: 4, dirty: true })
		);
		const sent = server([documentAnswer(0, null)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sent.map((call) => call.method)).toEqual(['GET']);
	});

	it('keeps the journal when the record names the household signing in', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 2, dirty: false })
		);
		server([documentAnswer(2, remoteState('Alex'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles).toHaveLength(1);
	});

	it('ignores a record that is not the shape it wrote', async () => {
		const store = journal();
		localStorage.setItem(SYNC_STORAGE_KEY, '{not json');
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sent[1]?.method).toBe('PUT');
	});

	it('ignores a record whose version is not a whole number', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 'four', dirty: false })
		);
		server([documentAnswer(2, remoteState('Robin'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		// Read as version 0, so the server's version 2 is newer and is taken.
		expect(store.state.profiles[0]?.name).toBe('Robin');
		expect(sync.version).toBe(2);
	});

	it('does not read a record that names no household as naming another one', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: 7, version: 1, dirty: false })
		);
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		// The record is unreadable, not somebody else's: the journal stays.
		expect(store.state.profiles).toHaveLength(1);
	});

	it('is not a record at all when it holds something that is not an object', async () => {
		const store = journal();
		localStorage.setItem(SYNC_STORAGE_KEY, '"h-other"');
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles).toHaveLength(1);
		expect(sent[1]?.method).toBe('PUT');
	});
});

describe('a device that is behind', () => {
	async function refusedPush(): Promise<{ store: TendStore; sync: SyncStore; sent: Sent[] }> {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 1, dirty: true })
		);
		const sent = server([documentAnswer(1, remoteState('Alex')), stale(2, remoteState('Robin'))]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		return { store, sync, sent };
	}

	it('takes the newer document instead of overwriting it', async () => {
		const { store } = await refusedPush();
		expect(store.state.profiles[0]?.name).toBe('Robin');
	});

	it('does not send its own document again after being refused', async () => {
		const { sent } = await refusedPush();
		expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT']);
	});

	it('records the version it adopted, with nothing left unsent', async () => {
		const { sync } = await refusedPush();
		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 2,
			dirty: false,
			outstanding: null
		});
		expect(sync.version).toBe(2);
	});

	it('tells the person on this device that it reloaded', async () => {
		await refusedPush();
		expect(announced).toEqual(['This device was behind, so it reloaded your newer data.']);
	});

	it('reports itself as having been stale', async () => {
		const { sync } = await refusedPush();
		expect(sync.status).toBe('stale');
	});

	it('adopts a newer document found by the read, and says so', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 1, dirty: false })
		);
		server([documentAnswer(5, remoteState('Robin'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles[0]?.name).toBe('Robin');
		expect(announced).toHaveLength(1);
	});

	it('sends nothing when the versions already agree', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 4, dirty: false })
		);
		const sent = server([documentAnswer(4, remoteState('Alex'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sent).toHaveLength(1);
		expect(sync.status).toBe('idle');
	});

	it('sends its own document when the server has fallen behind the record', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 6, dirty: false })
		);
		const sent = server([documentAnswer(2, remoteState('Alex')), stored(3)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sent[1]?.body).toMatchObject({ version: 2 });
		expect(sync.version).toBe(3);
	});

	it('records version zero and keeps its own document when the server has lost it', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 5, dirty: false })
		);
		const sent = server([documentAnswer(0, null), DROPPED]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 0,
			dirty: true,
			// The write never got an answer, so the device is still holding it.
			outstanding: { version: 0, fingerprints: [carried(sent[1])] }
		});
		expect(store.state.profiles).toHaveLength(1);
	});

	/**
	 * A device with nothing of its own sends nothing, so the version it is left
	 * claiming is whatever this read wrote down. Claiming one the account no
	 * longer has would have every write from here refused as stale.
	 */
	it('stops claiming a version the account has lost, with nothing of its own to send', async () => {
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 5, dirty: false })
		);
		const sent = server([documentAnswer(0, null)]);
		const sync = syncFor(blankDevice());

		await sync.start(HOUSEHOLD);

		expect(sent.map((call) => call.method)).toEqual(['GET']);
		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 0,
			dirty: false,
			outstanding: null
		});
	});

	it('records the version the server does hold when it has fallen behind', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 6, dirty: false })
		);
		const sent = server([documentAnswer(2, remoteState('Alex')), DROPPED]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 2,
			dirty: true,
			// As above: the write that would have moved it on was dropped.
			outstanding: { version: 2, fingerprints: [carried(sent[1])] }
		});
		expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT']);
	});

	it('refuses to be talked into sending for ever by a server that keeps refusing', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 3, dirty: true })
		);
		const sent = server([documentAnswer(3, remoteState('Alex')), stale(0, null), stale(0, null)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT']);
	});

	it('starts again from nothing when a refusal says the document is gone', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 3, dirty: true })
		);
		const sent = server([documentAnswer(3, remoteState('Alex')), stale(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sent[2]?.body).toMatchObject({ version: 0 });
		expect(sync.version).toBe(1);
	});
});

describe('a change that cannot be sent', () => {
	it('is kept, and the device says it is waiting', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), DROPPED]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(record()?.dirty).toBe(true);
		expect(sync.status).toBe('waiting');
		// One attempt, not a burst of them: retrying is what a trigger is for.
		expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT']);
	});

	it('survives a push that lands and a later one that does not', async () => {
		const store = journal();
		const gate = deferred();
		let puts = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if ((init?.method ?? 'GET') === 'GET') return documentAnswer(0, null);
			puts += 1;
			if (puts === 1) {
				await gate.promise;
				return stored(1);
			}
			throw DROPPED;
		});
		const sync = syncFor(store);

		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(puts).toBe(1));
		// Lands while the first request is in flight, so the answer to that
		// request says nothing about it.
		store.togglePantry('oats');
		gate.release();
		await started;

		expect(puts).toBe(2);
		expect(record()?.dirty).toBe(true);
		expect(sync.status).toBe('waiting');
	});

	it('is sent again as soon as the network returns', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), DROPPED, stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		globalThis.dispatchEvent(new Event('online'));

		await vi.waitFor(() => expect(sent).toHaveLength(3));
		await vi.waitFor(() => expect(record()?.dirty).toBe(false));
	});

	it('is sent again when the page comes back into view', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), DROPPED, stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		Object.defineProperty(globalThis.document, 'visibilityState', {
			value: 'visible',
			configurable: true
		});
		globalThis.dispatchEvent(new Event('visibilitychange'));

		await vi.waitFor(() => expect(sent).toHaveLength(3));
	});

	it('is sent again on the next write', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), DROPPED, stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		store.togglePantry('oats');

		await vi.waitFor(() => expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT']));
	});

	it('says it is waiting when the read fails and something is unsent', async () => {
		const store = journal();
		const sent = server([DROPPED]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('waiting');
		// Recorded before the first request, so a device that never reaches the
		// server still knows whose journal it holds and that it is unsent.
		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 0,
			dirty: true,
			outstanding: null
		});
		// And no write from a version it only guessed at.
		expect(sent.map((call) => call.method)).toEqual(['GET']);
	});

	it('says nothing is waiting when the read fails and nothing is unsent', async () => {
		server([DROPPED]);
		const sync = syncFor(blankDevice());

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('idle');
	});

	it('retries the read first when it was the read that never arrived', async () => {
		const store = journal();
		const sent = server([DROPPED, documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		expect(sent).toHaveLength(1);

		store.togglePantry('oats');

		await vi.waitFor(() => expect(sent.map((call) => call.method)).toEqual(['GET', 'GET', 'PUT']));
	});

	it('stops asking when the server refuses the device outright', async () => {
		const store = journal();
		const sent = server([jsonResponse({ error: { code: 'unauthenticated' } }, 401)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		// Not even the write it was holding: a device the read was refused for is
		// not one a write will be accepted from.
		expect(sent.map((call) => call.method)).toEqual(['GET']);
		expect(sync.status).toBe('error');
	});

	it('keeps the change when a write is refused outright', async () => {
		const store = journal();
		server([documentAnswer(0, null), jsonResponse({ error: { code: 'invalid-body' } }, 400)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(record()?.dirty).toBe(true);
		expect(sync.status).toBe('error');
	});
});

describe('a dropped request', () => {
	/**
	 * A server that answers the read and swallows every write, for ever. What a
	 * device holding something of its own does about that is the whole story
	 * here, so each attempt is exactly one PUT.
	 */
	function writesThatNeverLand(): () => number {
		let writes = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
			if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(documentAnswer(0, null));
			writes += 1;
			return Promise.reject(DROPPED);
		});
		return () => writes;
	}

	it('is sent again a second later, with nobody touching the app', async () => {
		vi.useFakeTimers();
		try {
			const sent = server([documentAnswer(0, null), DROPPED, stored(1)]);
			const sync = syncFor(journal());

			await sync.start(HOUSEHOLD);
			expect(sync.status).toBe('waiting');

			// No event, no visibility change, no further writing: the app is open
			// in front of the person who logged the workout and nothing but time
			// passes. A second is a wait, not an instant — this device is not
			// hammering a connection that has just dropped.
			await vi.advanceTimersByTimeAsync(999);
			expect(sent).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(1);

			expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT']);
			expect(record()?.dirty).toBe(false);
			expect(sync.status).toBe('idle');
		} finally {
			vi.useRealTimers();
		}
	});

	it('is read again a second later when it was the read that never arrived', async () => {
		vi.useFakeTimers();
		try {
			const sent = server([DROPPED, documentAnswer(2, remoteState('Robin'))]);
			const store = blankDevice();
			const sync = syncFor(store);

			await sync.start(HOUSEHOLD);
			// A device with nothing of its own is not waiting to send anything, so
			// nothing about its status says something went wrong. What it is
			// missing is the account's document — somebody has just signed in on a
			// new phone and is looking at an empty app.
			expect(sync.status).toBe('idle');

			await vi.advanceTimersByTimeAsync(1_000);

			expect(sent.map((call) => call.method)).toEqual(['GET', 'GET']);
			expect(store.state.profiles[0]?.name).toBe('Robin');
		} finally {
			vi.useRealTimers();
		}
	});

	it('is tried again more slowly each time, and only so many times', async () => {
		vi.useFakeTimers();
		try {
			const writes = writesThatNeverLand();
			const sync = syncFor(journal());
			await sync.start(HOUSEHOLD);
			expect(writes()).toBe(1);

			// The step each attempt waits, and how many writes there have been by
			// the time it is made. Asserted a millisecond either side of the step,
			// so a schedule that grew differently — or not at all — fails here
			// rather than merely arriving eventually.
			const steps: [number, number][] = [
				[1_000, 2],
				[4_000, 3],
				[16_000, 4],
				[60_000, 5]
			];
			for (const [delay, attempts] of steps) {
				await vi.advanceTimersByTimeAsync(delay - 1);
				expect(writes()).toBe(attempts - 1);
				await vi.advanceTimersByTimeAsync(1);
				expect(writes()).toBe(attempts);
			}

			// Four attempts is what one bad spell is worth. An hour of a phone in
			// somebody's pocket waking its radio at a server that is plainly down
			// is not, and the events are what own a connection gone that long.
			await vi.advanceTimersByTimeAsync(60 * 60_000);

			expect(writes()).toBe(5);
			expect(sync.status).toBe('waiting');
			expect(record()?.dirty).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('is taken off the clock by a change that supersedes it', async () => {
		vi.useFakeTimers();
		try {
			const writes = writesThatNeverLand();
			const store = journal();
			const sync = syncFor(store);
			await sync.start(HOUSEHOLD);
			expect(writes()).toBe(1);

			// Two hundred milliseconds into the first attempt's wait, somebody logs
			// something, which sends at once and arms an attempt of its own.
			await vi.advanceTimersByTimeAsync(200);
			store.togglePantry('oats');
			await vi.advanceTimersByTimeAsync(0);
			expect(writes()).toBe(2);

			// One attempt on the clock, never two: the wait the first failure armed
			// was replaced rather than both coming due and asking twice, which is
			// how a device with a bad connection and a busy person on it would
			// build a queue of its own making.
			await vi.advanceTimersByTimeAsync(1_500);

			expect(writes()).toBe(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives the next change its own attempts, however long the outage', async () => {
		vi.useFakeTimers();
		try {
			const writes = writesThatNeverLand();
			const store = journal();
			const sync = syncFor(store);
			await sync.start(HOUSEHOLD);
			await vi.advanceTimersByTimeAsync(1_000 + 4_000 + 16_000 + 60_000);
			expect(writes()).toBe(5);

			// The steps for that spell are spent, and then somebody logs a meal.
			// What they have just recorded is not made to inherit an exhausted
			// ladder: it is sent at once, and gets its own attempts behind it.
			store.togglePantry('oats');
			await vi.advanceTimersByTimeAsync(0);
			expect(writes()).toBe(6);

			await vi.advanceTimersByTimeAsync(1_000);

			expect(writes()).toBe(7);
		} finally {
			vi.useRealTimers();
		}
	});

	it('puts nothing more on the clock once the document has landed', async () => {
		vi.useFakeTimers();
		try {
			const sent = server([documentAnswer(0, null), DROPPED, stored(1)]);
			const sync = syncFor(journal());
			await sync.start(HOUSEHOLD);

			await vi.advanceTimersByTimeAsync(1_000);
			expect(record()?.dirty).toBe(false);

			// The moment the write is accepted there is nothing on the clock at
			// all. The count is what says so, where counting requests cannot: an
			// attempt made with nothing outstanding reaches a `drain` that sends
			// nothing, so a device left needlessly ticking looks exactly like one
			// that is not, and it is still a phone woken for no reason.
			// Nine hundred milliseconds later — long enough that the environment's
			// own machinery has run out, short of the second an attempt would have
			// waited — there is nothing on the clock at all. The count is what
			// says so, where counting requests cannot: an attempt made with
			// nothing outstanding reaches a `drain` that sends nothing, so a
			// device left needlessly ticking looks exactly like one that is not,
			// and it is still a phone woken for no reason.
			await vi.advanceTimersByTimeAsync(900);
			expect(vi.getTimerCount()).toBe(0);

			// And five minutes later it is still quiet.
			await vi.advanceTimersByTimeAsync(5 * 60_000);

			expect(sent).toHaveLength(3);
			expect(sync.status).toBe('idle');
		} finally {
			vi.useRealTimers();
		}
	});

	it('waits a second again after a bad spell the server ended', async () => {
		vi.useFakeTimers();
		try {
			const sent = server([
				documentAnswer(0, null),
				DROPPED,
				DROPPED,
				DROPPED,
				stored(1),
				DROPPED,
				stored(2)
			]);
			const store = journal();
			const sync = syncFor(store);
			await sync.start(HOUSEHOLD);

			// Three failures take the wait up to sixteen seconds, and the fourth
			// attempt is accepted.
			await vi.advanceTimersByTimeAsync(1_000 + 4_000 + 16_000);
			expect(sent).toHaveLength(5);
			expect(record()?.dirty).toBe(false);

			// A later change, dropped again. The next attempt is a second away, not
			// a minute: the steps are about the connection as it is now, and this
			// one has just been shown to work.
			store.togglePantry('oats');
			await vi.advanceTimersByTimeAsync(999);
			expect(sent).toHaveLength(6);
			await vi.advanceTimersByTimeAsync(1);

			expect(sent).toHaveLength(7);
			expect(record()).toEqual({
				householdId: HOUSEHOLD,
				version: 2,
				dirty: false,
				outstanding: null
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('is refused rather than clobbering when the retry loses a version race', async () => {
		vi.useFakeTimers();
		try {
			localStorage.setItem(
				SYNC_STORAGE_KEY,
				JSON.stringify({ householdId: HOUSEHOLD, version: 3, dirty: true })
			);
			const sent = server([
				documentAnswer(3, remoteState('Alex')),
				DROPPED,
				stale(0, null),
				stored(1)
			]);
			const store = journal();
			const sync = syncFor(store);
			await sync.start(HOUSEHOLD);
			expect(record()?.dirty).toBe(true);

			await vi.advanceTimersByTimeAsync(1_000);

			// The retry was refused — the version it wrote from no longer exists —
			// and what this device is holding went out again from the version the
			// server does hold rather than being dropped on the floor.
			expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT', 'PUT']);
			expect(sent[3]?.body).toMatchObject({ version: 0 });
			expect(record()).toEqual({
				householdId: HOUSEHOLD,
				version: 1,
				dirty: false,
				outstanding: null
			});
			expect(store.state.profiles[0]?.name).toBe('Alex');
			expect(announced).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('is not tried again while the account holds a document a newer build wrote', async () => {
		vi.useFakeTimers();
		try {
			const fromANewerBuild = { ...remoteState('Robin'), schemaVersion: SCHEMA_VERSION + 1 };
			const sent = server([documentAnswer(3, fromANewerBuild)]);
			const sync = syncFor(journal());
			await sync.start(HOUSEHOLD);
			expect(sync.status).toBe('outdated');

			await vi.advanceTimersByTimeAsync(5 * 60_000);

			// The latch holds against the clock as well as against the three
			// events: a device that must not write is not talked into writing by
			// the fact that it is still holding something.
			expect(sent).toHaveLength(1);
			expect(sync.status).toBe('outdated');
		} finally {
			vi.useRealTimers();
		}
	});

	it('is not tried again while this device could not read its own document', async () => {
		vi.useFakeTimers();
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ pantry: ['rice'], schemaVersion: SCHEMA_VERSION + 1 })
			);
			const store = new TendStore();
			store.hydrate();
			const sent = server([documentAnswer(0, null)]);
			const sync = syncFor(store);
			await sync.start(HOUSEHOLD);
			expect(store.refusal?.reason).toBe('future');

			await vi.advanceTimersByTimeAsync(5 * 60_000);

			// The read landed, so there is nothing to try again; the empty state
			// standing in for a document this build could not read is never sent,
			// on a timer or otherwise.
			expect(sent.map((call) => call.method)).toEqual(['GET']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('is not tried again once the device has been forgotten', async () => {
		vi.useFakeTimers();
		try {
			const sent = server([documentAnswer(0, null), DROPPED]);
			const sync = syncFor(journal());
			await sync.start(HOUSEHOLD);

			sync.forget();
			await vi.advanceTimersByTimeAsync(5 * 60_000);

			expect(sent).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('writes while sync is running', () => {
	it('records a change as unsent the moment it arrives, not when it is sent', async () => {
		const store = blankDevice();
		let puts = 0;
		let inTheAir: Sent | undefined;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method !== 'PUT') return documentAnswer(2, remoteState('Robin'));
			puts += 1;
			const raw = init.body;
			inTheAir = {
				path: '/api/state',
				method: init.method,
				contentType: undefined,
				body: typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : null
			};
			await gate.promise;
			return stored(3);
		});
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 2,
			dirty: false,
			outstanding: null
		});

		store.togglePantry('oats');
		// Before the exchange it triggers has had a microtask to begin in: the
		// record is what a tab closed this instant would leave behind.
		expect(record()?.dirty).toBe(true);
		await vi.waitFor(() => expect(puts).toBe(1));

		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 2,
			dirty: true,
			// The write is in the air, and the record says so before its answer
			// exists — which is what makes it recognizable after a reload.
			outstanding: { version: 2, fingerprints: [carried(inTheAir)] }
		});
		gate.release();
	});

	it('coalesces a burst into one request in flight and one queued', async () => {
		const store = journal();
		const gate = deferred();
		let puts = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if ((init?.method ?? 'GET') === 'GET') return documentAnswer(0, null);
			puts += 1;
			if (puts === 1) await gate.promise;
			return stored(puts);
		});
		const sync = syncFor(store);
		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(puts).toBe(1));

		store.togglePantry('oats');
		store.togglePantry('rice');
		store.togglePantry('beans');
		gate.release();
		await started;

		expect(puts).toBe(2);
	});

	it('does not send back a document it has just adopted', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 1, dirty: false })
		);
		const sent = server([documentAnswer(5, remoteState('Robin'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(sync.status).toBe('stale'));

		expect(sent.map((call) => call.method)).toEqual(['GET']);
	});
});

describe('signing out', () => {
	it('reports unsent changes rather than dropping them', async () => {
		const store = journal();
		server([documentAnswer(0, null), DROPPED, DROPPED]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		await expect(sync.flush()).resolves.toBe(false);
	});

	it('reports everything sent once the server has taken it', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		await expect(sync.flush()).resolves.toBe(true);
	});

	it('has nothing to flush before it has started', async () => {
		const sync = syncFor(journal());
		await expect(sync.flush()).resolves.toBe(true);
	});

	it('has nothing to flush once it has stopped', async () => {
		const store = journal();
		server([documentAnswer(0, null), DROPPED]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		expect(await sync.flush()).toBe(false);

		sync.stop();

		await expect(sync.flush()).resolves.toBe(true);
	});

	it('leaves neither the document nor the record on the device', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		sync.forget();

		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(localStorage.getItem(SYNC_STORAGE_KEY)).toBeNull();
		expect(store.state.profiles).toEqual([]);
	});

	it('asks the server for nothing more once it has been forgotten', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		sync.forget();
		store.togglePantry('oats');
		globalThis.dispatchEvent(new Event('online'));
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(sent).toHaveLength(2);
		// Nor is a record written for the household that has just been forgotten.
		expect(localStorage.getItem(SYNC_STORAGE_KEY)).toBeNull();
	});

	it('writes no record for a household it has already forgotten', async () => {
		const store = journal();
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			await gate.promise;
			return documentAnswer(0, null);
		});
		const sync = syncFor(store);

		const started = sync.start(HOUSEHOLD);
		// Signing out while the read is still in the air.
		sync.forget();
		gate.release();
		await started;

		expect(localStorage.getItem(SYNC_STORAGE_KEY)).toBeNull();
	});

	it('counts nothing the store writes after it has been forgotten', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		sync.forget();
		store.hydrate();
		store.togglePantry('oats');

		// The device is not syncing, so what it writes is nobody's unsent work.
		await expect(sync.flush()).resolves.toBe(true);
	});

	it('starts again for the next account to sign in here', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1), documentAnswer(2, remoteState('Robin'))]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		sync.forget();

		await sync.start('h-2');

		expect(store.state.profiles[0]?.name).toBe('Robin');
		expect(record()?.householdId).toBe('h-2');
	});
});

describe('while a request is in the air', () => {
	function held(answer: Response): { asked: () => number; release: () => void } {
		let asked = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			asked += 1;
			await gate.promise;
			return answer;
		});
		return { asked: () => asked, release: gate.release };
	}

	/** A server whose writes hang until released, and whose reads answer at once. */
	function heldWrites(read: Response): { puts: () => number; release: () => void } {
		let puts = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method !== 'PUT') return read;
			puts += 1;
			await gate.promise;
			return stored(99);
		});
		return { puts: () => puts, release: gate.release };
	}

	it('says it is reading while it reads', async () => {
		const gate = held(documentAnswer(0, null));
		const sync = syncFor(blankDevice());

		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(sync.status).toBe('loading'));

		gate.release();
		await started;
	});

	it('is already loading the instant start is called, before any request lands', () => {
		// A caller that renders off `status` right after calling `start` — the
		// gate between a loading screen and Onboarding — must never catch a tick
		// where the household is set but the read has not been marked under way.
		// This is checked with no `await` at all: the assertion runs before the
		// microtask that issues the request has even had a chance to.
		const gate = held(documentAnswer(0, null));
		const sync = syncFor(blankDevice());

		void sync.start(HOUSEHOLD);

		expect(sync.status).toBe('loading');
		gate.release();
	});

	it('says it is reading again on a retry, after a first read that never landed', async () => {
		// The first pull never counts as read (it was `unreachable`, not
		// `refused`), so a later trigger reads again — and that second read
		// marks `status` as `loading` on its own, the same as the first did.
		const sent = server([DROPPED]);
		const sync = syncFor(blankDevice());
		await sync.start(HOUSEHOLD);
		expect(sent).toHaveLength(1);
		expect(sync.status).toBe('idle');

		const gate = held(documentAnswer(0, null));
		globalThis.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(sync.status).toBe('loading'));

		gate.release();
	});

	it('says it is saving while it saves', async () => {
		const server = heldWrites(documentAnswer(0, null));
		const sync = syncFor(journal());

		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(server.puts()).toBe(1));
		expect(sync.status).toBe('saving');

		server.release();
		await started;
	});

	it('acts on no answer to a read that lands after signing out', async () => {
		const store = journal();
		const gate = held(documentAnswer(4, remoteState('Robin')));
		const sync = syncFor(store);

		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(gate.asked()).toBe(1));
		sync.forget();
		gate.release();
		await started;

		// The document went with the sign-out; a late answer must not put the
		// last account's journal back on the device.
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(localStorage.getItem(SYNC_STORAGE_KEY)).toBeNull();
	});

	it('acts on no answer to a write that lands after signing out', async () => {
		const server = heldWrites(documentAnswer(0, null));
		const sync = syncFor(journal());

		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(server.puts()).toBe(1));
		sync.forget();
		server.release();
		await started;

		expect(localStorage.getItem(SYNC_STORAGE_KEY)).toBeNull();
	});

	it('never sends the emptied store to the account it has just left', async () => {
		const store = journal();
		const server = heldWrites(documentAnswer(0, null));
		const sync = syncFor(store);

		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(server.puts()).toBe(1));
		sync.forget();
		// A write reaching the store after the sign-out: the drawer's toast, a
		// stray effect, anything. It must not become a second request.
		store.hydrate();
		store.togglePantry('oats');
		server.release();
		await started;

		expect(server.puts()).toBe(1);
	});

	it('puts a document refused after signing out nowhere', async () => {
		const store = journal();
		let puts = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method !== 'PUT') return documentAnswer(0, null);
			puts += 1;
			await gate.promise;
			return stale(4, remoteState('Robin'));
		});
		const sync = syncFor(store);

		const started = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(puts).toBe(1));
		sync.forget();
		gate.release();
		await started;

		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(store.state.profiles).toEqual([]);
	});
});

describe('a connection that never answers at all', () => {
	/**
	 * A server whose `fetch` never resolves on its own — a half-open socket, a
	 * captive portal that swallows the request. The only way this promise ever
	 * settles is the `AbortSignal` `ask()` passes in, which is exactly the
	 * mechanism under test: without it, this is a promise nothing ever ends.
	 */
	function hungConnection(): { aborted: () => number } {
		let aborted = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
			const signal = init?.signal;
			return new Promise((_resolve, reject) => {
				signal?.addEventListener('abort', () => {
					aborted += 1;
					reject(new DOMException('The operation was aborted.', 'AbortError'));
				});
			});
		});
		return { aborted: () => aborted };
	}

	it('gives up on its own rather than leaving status stuck at loading forever', async () => {
		vi.useFakeTimers();
		try {
			const connection = hungConnection();
			const sync = syncFor(blankDevice());

			const started = sync.start(HOUSEHOLD);
			expect(sync.status).toBe('loading');

			// Past the request's own timeout and short of the second in which the
			// first retry follows it, with nothing else in the test ever resolving
			// the connection. What happens after that second is a story of its
			// own, in 'a dropped request' above.
			await vi.advanceTimersByTimeAsync(10_500);
			await started;

			expect(connection.aborted()).toBe(1);
			expect(sync.status).not.toBe('loading');
		} finally {
			vi.useRealTimers();
		}
	});

	it('lands on the same status a plainly dropped connection would', async () => {
		// A device holding something of its own: the outcome of a timed-out read
		// must be indistinguishable from any other unreachable server, `waiting`
		// among the possibilities exactly as it is for a dropped connection.
		vi.useFakeTimers();
		try {
			hungConnection();
			const sync = syncFor(journal());

			const started = sync.start(HOUSEHOLD);
			await vi.advanceTimersByTimeAsync(10_500);
			await started;

			expect(sync.status).toBe('waiting');
		} finally {
			vi.useRealTimers();
		}
	});

	it('clears its own timeout once an answer arrives, rather than leaving it pending', async () => {
		// A request the server answered promptly still armed a timer against a
		// hang that never happened. Leaving that timer running would eventually
		// abort a signal nothing is listening to any more — harmless, but a real
		// resource this device should not be holding on to for ten seconds
		// after the exchange it was for is long done. Asserted directly against
		// `clearTimeout` rather than a pending-timer count: this environment's
		// own machinery holds timers of its own that have nothing to do with
		// this request, and a count is not a reliable way to isolate one call.
		const cleared = vi.spyOn(globalThis, 'clearTimeout');
		server([documentAnswer(0, null)]);
		const sync = syncFor(blankDevice());

		await sync.start(HOUSEHOLD);

		expect(cleared).toHaveBeenCalled();
	});
});

describe('when the next account signs in before the last answer lands', () => {
	/**
	 * The window `AccountMenu` opens: `flush()` has returned, the sign-out round
	 * trip is still going, and a retry on `online` or `visibilitychange` has put
	 * a request in the air that nothing cancels. On a shared device the next
	 * person can be signed in before it answers.
	 */
	function handOver(sync: SyncStore): Promise<void> {
		sync.forget();
		return sync.start('h-2');
	}

	it('never takes one account’s document into the next account’s store', async () => {
		const store = journal();
		let reads = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method === 'PUT') return stored(8);
			reads += 1;
			if (reads === 1) {
				await gate.promise;
				return documentAnswer(7, remoteState('AccountA'));
			}
			return documentAnswer(0, null);
		});
		const sync = syncFor(store);

		const first = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(reads).toBe(1));
		const second = handOver(sync);
		gate.release();
		await Promise.all([first, second]);

		expect(store.state.profiles).toEqual([]);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('never records the last account’s version against the next one', async () => {
		const store = journal();
		let reads = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method === 'PUT') return stored(8);
			reads += 1;
			if (reads === 1) {
				await gate.promise;
				return documentAnswer(7, remoteState('AccountA'));
			}
			return documentAnswer(0, null);
		});
		const sync = syncFor(store);

		const first = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(reads).toBe(1));
		const second = handOver(sync);
		gate.release();
		await Promise.all([first, second]);

		expect(record()).toEqual({
			householdId: 'h-2',
			version: 0,
			dirty: false,
			outstanding: null
		});
		expect(sync.version).toBe(0);
	});

	it('reads the next account’s own document rather than waiting on the last one’s', async () => {
		const store = journal();
		let reads = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method === 'PUT') return stored(8);
			reads += 1;
			if (reads === 1) {
				await gate.promise;
				return documentAnswer(7, remoteState('AccountA'));
			}
			return documentAnswer(3, remoteState('AccountB'));
		});
		const sync = syncFor(store);

		const first = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(reads).toBe(1));
		const second = handOver(sync);
		gate.release();
		await Promise.all([first, second]);

		expect(reads).toBe(2);
		expect(store.state.profiles[0]?.name).toBe('AccountB');
		expect(sync.version).toBe(3);
	});

	it('does not let the last account’s exchange close the one under way', async () => {
		const store = journal();
		let reads = 0;
		const leaving = deferred();
		const arriving = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method === 'PUT') return stored(1);
			reads += 1;
			if (reads === 1) {
				await leaving.promise;
				return documentAnswer(7, remoteState('AccountA'));
			}
			await arriving.promise;
			return documentAnswer(0, null);
		});
		const sync = syncFor(store);

		const first = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(reads).toBe(1));
		const second = handOver(sync);
		await vi.waitFor(() => expect(reads).toBe(2));
		// The account that left finishes while the new one is still reading.
		leaving.release();
		await first;

		// Something asks again in that moment; the read already in the air is
		// the answer, not a reason to open a second one.
		store.hydrate();
		store.togglePantry('oats');
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(reads).toBe(2);

		arriving.release();
		await second;
	});

	it('never claims the version one account’s write created for the next one', async () => {
		const store = journal();
		let puts = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method !== 'PUT') return documentAnswer(0, null);
			puts += 1;
			if (puts === 1) {
				await gate.promise;
				return stored(9);
			}
			return stored(1);
		});
		const sync = syncFor(store);

		const first = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(puts).toBe(1));
		const second = handOver(sync);
		gate.release();
		await Promise.all([first, second]);

		expect(record()).toEqual({
			householdId: 'h-2',
			version: 0,
			dirty: false,
			outstanding: null
		});
		expect(sync.version).toBe(0);
	});

	it('never adopts a document one account’s write was refused with', async () => {
		const store = journal();
		let puts = 0;
		const gate = deferred();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
			if (init?.method !== 'PUT') return documentAnswer(0, null);
			puts += 1;
			if (puts === 1) {
				await gate.promise;
				return stale(6, remoteState('AccountA'));
			}
			return stored(1);
		});
		const sync = syncFor(store);

		const first = sync.start(HOUSEHOLD);
		await vi.waitFor(() => expect(puts).toBe(1));
		const second = handOver(sync);
		gate.release();
		await Promise.all([first, second]);

		expect(store.state.profiles).toEqual([]);
		expect(announced).toEqual([]);
		expect(record()).toEqual({
			householdId: 'h-2',
			version: 0,
			dirty: false,
			outstanding: null
		});
	});
});

describe('the retry listeners', () => {
	it('are bound once, however many times syncing starts', async () => {
		const store = journal();
		const bound = vi.spyOn(globalThis, 'addEventListener');
		server([documentAnswer(0, null), stored(1), documentAnswer(1, remoteState('Alex'))]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		sync.forget();
		await sync.start('h-2');

		// One for `online`, one for `visibilitychange` — never more.
		expect(bound).toHaveBeenCalledTimes(2);
	});

	it('are not asked for where there is nothing to bind them to', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		vi.stubGlobal('addEventListener', undefined);
		try {
			const sync = syncFor(store);
			await expect(sync.start(HOUSEHOLD)).resolves.toBeUndefined();
			expect(sync.version).toBe(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	/**
	 * The pair to the one below, and the reason it is worth having both: a device
	 * that could not reach the server is very often a phone that was put away, so
	 * coming back into view is the moment it is most likely to succeed.
	 */
	it('try again for a page that has come back into view', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), DROPPED, stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		expect(sync.status).toBe('waiting');

		Object.defineProperty(globalThis.document, 'visibilityState', {
			value: 'visible',
			configurable: true
		});
		globalThis.dispatchEvent(new Event('visibilitychange'));

		await vi.waitFor(() => expect(sync.version).toBe(1));
		expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT']);
	});

	it('do not try again for a page that went out of view rather than into it', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), DROPPED]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		Object.defineProperty(globalThis.document, 'visibilityState', {
			value: 'hidden',
			configurable: true
		});
		globalThis.dispatchEvent(new Event('visibilitychange'));
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(sent.map((call) => call.method)).toEqual(['GET', 'PUT']);
	});
});

describe('the running state', () => {
	it('does not start over for the household it is already syncing', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		await sync.start(HOUSEHOLD);

		expect(sent).toHaveLength(2);
	});

	it('reports itself idle once a document has been sent', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('idle');
	});

	it('forgets the version when it is stopped', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		sync.stop();

		expect(sync.version).toBe(0);
		expect(sync.status).toBe('idle');
	});

	it('leaves the document alone when it is merely stopped', async () => {
		const store = journal();
		server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		sync.stop();

		expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
		expect(localStorage.getItem(SYNC_STORAGE_KEY)).not.toBeNull();
	});

	it('works where there is no browser storage at all', async () => {
		const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
		try {
			const store = new TendStore();
			store.hydrate();
			server([documentAnswer(0, null)]);
			const sync = syncFor(store);
			await sync.start(HOUSEHOLD);
			expect(sync.status).toBe('idle');
			expect(() => sync.forget()).not.toThrow();
		} finally {
			if (real) Object.defineProperty(globalThis, 'localStorage', real);
		}
	});
});

describe('a household whose document a newer build wrote', () => {
	/** What a build one rung up this ladder would leave on the server. */
	function fromANewerBuild(): Record<string, unknown> {
		return { ...remoteState('Robin'), schemaVersion: SCHEMA_VERSION + 1 };
	}

	it('is not adopted, and this device keeps what it has', async () => {
		const store = journal();
		const sent = server([documentAnswer(3, fromANewerBuild())]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles[0]?.name).toBe('Alex');
		expect(sync.status).toBe('outdated');
		expect(sync.version).toBe(0);
		// One request, and no PUT: this device's older document is never offered
		// in place of the one it could not read.
		expect(sent.map((call) => call.method)).toEqual(['GET']);
	});

	it('says so, rather than letting sync look merely broken', async () => {
		server([documentAnswer(3, fromANewerBuild())]);
		const sync = syncFor(journal());

		await sync.start(HOUSEHOLD);

		expect(announced).toEqual([OUTDATED_MESSAGE]);
	});

	it('leaves this device still holding its own work, unsent', async () => {
		const sync = syncFor(journal());
		server([documentAnswer(3, fromANewerBuild())]);

		await sync.start(HOUSEHOLD);

		expect(record()?.dirty).toBe(true);
		expect(await sync.flush()).toBe(false);
	});

	it('stops the conversation: a later change is not sent either', async () => {
		const store = journal();
		const sent = server([documentAnswer(3, fromANewerBuild())]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);

		store.state.pantry.push('oats');
		store.persist();
		await sync.flush();

		expect(sent).toHaveLength(1);
	});

	it('is refused just as firmly when it arrives as a refused write', async () => {
		const store = journal();
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 3, dirty: true })
		);
		const sent = server([documentAnswer(3, remoteState('Robin')), stale(4, fromANewerBuild())]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('outdated');
		expect(store.state.profiles[0]?.name).toBe('Alex');
		expect(record()?.dirty).toBe(true);
		// The refusal is not followed by a second attempt at the same write.
		expect(sent).toHaveLength(2);
	});

	it('starts over when a different account signs in on this device', async () => {
		const sent = server([documentAnswer(3, fromANewerBuild()), documentAnswer(0, null)]);
		const sync = syncFor(journal());
		await sync.start(HOUSEHOLD);

		await sync.start('h-2');

		// The block belongs to the document that caused it, not to the device.
		expect(sent.map((call) => call.method)).toEqual(['GET', 'GET']);
		expect(sync.status).toBe('idle');
	});
});

describe('a document that is not the shape this build expects', () => {
	it('is not adopted, and this device keeps what it has', async () => {
		const store = journal();
		server([documentAnswer(3, { schemaVersion: SCHEMA_VERSION, onboarded: 'yes' })]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.state.profiles[0]?.name).toBe('Alex');
		expect(sync.status).toBe('error');
		expect(sync.version).toBe(0);
	});
});

describe('the version this device sends', () => {
	it('goes out with the document, so the next reader knows its shape', async () => {
		const store = journal();
		const sent = server([documentAnswer(0, null), stored(1)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		const put = sent[1]?.body as { format: string; body: Record<string, unknown> } | undefined;
		expect(put?.format).toBe(`tend.v${SCHEMA_VERSION}`);
		expect(put?.body['schemaVersion']).toBe(SCHEMA_VERSION);
	});

	it('survives the round trip, so another device reads what this one wrote', async () => {
		const first = journal();
		const sent = server([documentAnswer(0, null), stored(1)]);
		await syncFor(first).start(HOUSEHOLD);
		const pushed = (sent[1]?.body as { body: Record<string, unknown> }).body;

		vi.restoreAllMocks();
		localStorage.clear();
		const second = blankDevice();
		server([documentAnswer(1, pushed)]);
		const sync = syncFor(second);

		await sync.start(HOUSEHOLD);

		expect(sync.status).toBe('idle');
		expect(second.state.profiles[0]?.name).toBe('Alex');
	});
});

describe('a device that could not read its own document', () => {
	/** A device holding a document written by a build one rung further up. */
	function unreadable(): TendStore {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ pantry: ['rice'], schemaVersion: SCHEMA_VERSION + 1 })
		);
		const store = new TendStore();
		store.hydrate();
		return store;
	}

	it('does not offer its empty state to a household with nothing stored', async () => {
		const store = unreadable();
		const sent = server([documentAnswer(0, null)]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		// The one request is the read. Pushing here would make the empty document
		// the account's, and every other device would adopt it.
		expect(sent.map((call) => call.method)).toEqual(['GET']);
		expect(store.refusal?.reason).toBe('future');
	});

	it('does not offer it to a household that is behind, either', async () => {
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({ householdId: HOUSEHOLD, version: 4, dirty: true })
		);
		const sent = server([documentAnswer(2, remoteState('Robin'))]);
		const sync = syncFor(unreadable());

		await sync.start(HOUSEHOLD);

		expect(sent.map((call) => call.method)).toEqual(['GET']);
	});

	it('recovers when the account has a document it can read', async () => {
		const store = unreadable();
		const refused = localStorage.getItem(STORAGE_KEY);
		server([documentAnswer(3, remoteState('Robin'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(store.refusal).toBeNull();
		expect(store.state.profiles[0]?.name).toBe('Robin');
		expect(sync.version).toBe(3);
		// The device works again, and the document it could not read — the only
		// copy of whatever the newer build recorded here — was kept rather than
		// deleted on the way past. See `REFUSED_STORAGE_KEY`.
		expect(localStorage.getItem(REFUSED_STORAGE_KEY)).toBe(refused);
	});
});

/**
 * #247. The device sent a write, the server took it, and the answer never got
 * back — the tab was reloaded or closed with the request still in the air. The
 * account is now one version ahead of what this device last heard, and that
 * version is this device's own document from a moment ago. Read as another
 * device's work it gets adopted, and whatever was recorded between the write
 * leaving and the reload is gone with no sign of it. What made it visible was a
 * height saved on the You screen and reverted by the reload; nothing about it is
 * particular to height, and every other save on every other screen sits in the
 * same window.
 */
describe('a write the server took and never answered', () => {
	/** A device holding an unanswered write, and the document that write carried. */
	async function abandonedWrite(): Promise<{ store: TendStore; carried: Record<string, unknown> }> {
		const store = journal();
		const sent = server([documentAnswer(0, null), DROPPED]);
		const sync = syncFor(store);
		await sync.start(HOUSEHOLD);
		// Nothing more from this device: what happens next is a reload.
		sync.stop();
		const put = sent[1]?.body as { body: Record<string, unknown> };
		return { store, carried: put.body };
	}

	/** The same device coming back up, reading what the last one left behind. */
	function afterTheReload(): TendStore {
		const store = new TendStore();
		store.hydrate();
		return store;
	}

	it('does not let it undo what was saved after it', async () => {
		const { store, carried } = await abandonedWrite();
		// The save the person made while that write was in the air.
		store.togglePantry('oats');

		const reloaded = afterTheReload();
		const sent = server([documentAnswer(1, carried), stored(2)]);
		const sync = syncFor(reloaded);
		await sync.start(HOUSEHOLD);

		expect(reloaded.state.pantry).toEqual(['oats']);
		expect(announced).toEqual([]);
		expect(sync.version).toBe(2);
		// And it goes out from where the server actually is, not from the version
		// this device last heard about.
		expect(sent[1]?.body).toMatchObject({ version: 1 });
	});

	it('is not counted as sent, so what is here still reaches the account', async () => {
		const { store, carried } = await abandonedWrite();
		store.togglePantry('oats');

		const reloaded = afterTheReload();
		const sent = server([documentAnswer(1, carried), stored(2)]);
		const sync = syncFor(reloaded);
		await sync.start(HOUSEHOLD);

		const put = sent[1]?.body as { body: { pantry: string[] } } | undefined;
		expect(put?.body.pantry).toEqual(['oats']);
		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 2,
			dirty: false,
			outstanding: null
		});
	});

	/**
	 * The other half of the same decision, and the reason the document is
	 * identified rather than the version merely counted: another device writing at
	 * that moment lands on exactly the version this one's write would have. Its
	 * work is adopted and said out loud, as it was before any of this.
	 */
	it('still gives way to another device that wrote at the same moment', async () => {
		const { store } = await abandonedWrite();
		store.togglePantry('oats');

		const reloaded = afterTheReload();
		server([documentAnswer(1, remoteState('Robin')), stored(2)]);
		const sync = syncFor(reloaded);
		await sync.start(HOUSEHOLD);

		expect(reloaded.state.profiles[0]?.name).toBe('Robin');
		expect(announced).toEqual(['This device was behind, so it reloaded your newer data.']);
	});

	/**
	 * The same loss without a reload, which is the half #253 left open.
	 *
	 * Nothing here is closed or reloaded. The device sends, hears nothing, and
	 * goes on being used — the retry clock a second later, and a meal logged in
	 * between. That second write is refused as stale, and what comes back with
	 * the refusal is the document the *first* write put there. A device that
	 * remembers only its most recent write does not recognise it, adopts it, and
	 * throws away everything logged since — while telling the person it has just
	 * reloaded their newer data, which is the opposite of what happened.
	 */
	describe('while the app is still open', () => {
		/**
		 * A server that takes the first write and loses its answer, refuses
		 * anything sent afterwards from that same version, and behaves normally
		 * from there. The one lost answer is the whole scenario; everything else
		 * about it is an ordinary server.
		 */
		function lostOneAnswer(): Sent[] {
			const sent: Sent[] = [];
			let version = 0;
			let held: Record<string, unknown> | null = null;
			vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
				const call = noteCall(sent, input, init);
				if ((init?.method ?? 'GET') === 'GET')
					return Promise.resolve(documentAnswer(version, held));
				const write = call.body as { version: number; body: Record<string, unknown> };
				if (write.version !== version) return Promise.resolve(stale(version, held));
				version += 1;
				held = write.body;
				return version === 1 ? Promise.reject(DROPPED) : Promise.resolve(stored(version));
			});
			return sent;
		}

		/** The device up to the point where it is holding an unheard write. */
		async function unheardWrite(): Promise<{ store: TendStore; sync: SyncStore; sent: Sent[] }> {
			const sent = lostOneAnswer();
			const store = journal();
			const sync = syncFor(store);
			await sync.start(HOUSEHOLD);
			expect(sync.status).toBe('waiting');
			return { store, sync, sent };
		}

		it('does not let a refusal carrying it undo what was logged after it', async () => {
			vi.useFakeTimers();
			try {
				const { store, sync } = await unheardWrite();

				// The meal logged while the device was holding that write. Its own
				// send is refused as stale, and the refusal carries the earlier
				// document back.
				store.togglePantry('oats');
				await vi.advanceTimersByTimeAsync(2_000);

				expect(store.state.pantry).toEqual(['oats']);
				expect(announced).toEqual([]);
				expect(sync.status).toBe('idle');
			} finally {
				vi.useRealTimers();
			}
		});

		it('sends it on from the version the server turned out to be at', async () => {
			vi.useFakeTimers();
			try {
				const { store, sync, sent } = await unheardWrite();

				store.togglePantry('oats');
				await vi.advanceTimersByTimeAsync(2_000);

				const last = sent.at(-1);
				expect(last?.body).toMatchObject({ version: 1 });
				expect((last?.body as { body: { pantry: string[] } }).body.pantry).toEqual(['oats']);
				expect(sync.version).toBe(2);
				expect(record()).toEqual({
					householdId: HOUSEHOLD,
					version: 2,
					dirty: false,
					outstanding: null
				});
			} finally {
				vi.useRealTimers();
			}
		});

		/**
		 * The other half again: a document at that version this device did not
		 * write is another device's, and is adopted and said out loud however many
		 * writes of its own this one is holding.
		 */
		it('still gives way to another device that wrote at the same moment', async () => {
			vi.useFakeTimers();
			try {
				const { store } = await unheardWrite();
				// From here the account is a version on, and not because of this device.
				server([stale(1, remoteState('Robin'))]);

				store.togglePantry('oats');
				await vi.advanceTimersByTimeAsync(2_000);

				expect(store.state.profiles[0]?.name).toBe('Robin');
				expect(announced).toEqual(['This device was behind, so it reloaded your newer data.']);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	/**
	 * The same letting go, from a read rather than a refusal, and written down
	 * rather than only held in memory. The account is still at the version this
	 * device last heard about, so that write did not land and never will. Left
	 * in the record it would outlive the device it belongs to and answer for the
	 * next document that arrives at that version — somebody else's — and stop it
	 * being adopted.
	 */
	it('stops naming a write the account plainly never took', async () => {
		localStorage.setItem(
			SYNC_STORAGE_KEY,
			JSON.stringify({
				householdId: HOUSEHOLD,
				version: 5,
				dirty: false,
				outstanding: { version: 5, fingerprints: ['a-write-that-never-landed'] }
			})
		);
		server([documentAnswer(5, remoteState('Robin'))]);
		const sync = syncFor(blankDevice());

		await sync.start(HOUSEHOLD);

		expect(record()).toEqual({
			householdId: HOUSEHOLD,
			version: 5,
			dirty: false,
			outstanding: null
		});
	});

	/**
	 * A write that was refused did not create the version it was sent from plus
	 * one, whoever did. Holding on to it past a refusal would let a document
	 * somebody else wrote be mistaken for this device's own at the next start.
	 */
	it('is let go of the moment the server refuses it', async () => {
		const store = journal();
		server([documentAnswer(0, null), stale(1, remoteState('Robin'))]);
		const sync = syncFor(store);

		await sync.start(HOUSEHOLD);

		expect(record()?.outstanding).toBeNull();
	});
});
