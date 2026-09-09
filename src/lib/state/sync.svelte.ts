import { resolve } from '$app/paths';
import {
	documentIsFromTheFuture,
	OUTDATED_MESSAGE,
	SCHEMA_VERSION,
	stateFormat,
	storedDocument,
	type StoredDocument
} from '$lib/domain/state-document';
import { refusedForSize, refusedSize, worthSending } from '$lib/domain/state-size';
import { toast } from '$lib/ui/toast.svelte';
import {
	fingerprint,
	isOwnWrite,
	outstandingWriteIn,
	pendingWrite,
	type OutstandingWrite
} from './outstanding-write';
import { SyncRetry } from './sync-retry';
import { STORAGE_KEY, tend } from './tend.svelte';
import type { TendStore } from './tend.svelte';

/**
 * The conversation with `/api/state`.
 *
 * The server holds one opaque JSON document per household and a version number.
 * This module decides when to read it, when to write it, and — the only part
 * that can lose somebody's data — which copy wins when the two disagree. Four
 * rules cover that:
 *
 * 1. A device with a document of its own and a server with none pushes. That is
 *    how every device predating sync migrates, and there is one chance at it per
 *    device: adopting an empty server would empty the phone instead.
 * 2. A device the server refuses as stale adopts what came back and says so. It
 *    never merges and never overwrites; merging is a later story, and silence is
 *    what would make the loss invisible.
 * 3. Nothing is marked sent until a write carrying it has been accepted.
 * 4. An answer that arrives after this device signed out is not acted on.
 * 5. A version the server reached because of this device's own unanswered write
 *    is not another device's work, and is not adopted over what is here. See
 *    `outstanding-write.ts`.
 *
 * The whole `TendState` document is synced, `onboarded` and `activeProfileId`
 * included: with one account per household both belong to the account rather
 * than to the device.
 */

export const SYNC_STORAGE_KEY = 'tend.sync.v1';

/**
 * The format this build writes: the schema version of the document inside. The
 * server stores it without reading the body, so it neither needs nor is told
 * anything more. Which copy a device may use, and which it must refuse, is
 * decided here from the document's own `schemaVersion` rather than from this
 * label — one source of truth, and the one that travels with the data.
 */
const STATE_FORMAT = stateFormat(SCHEMA_VERSION);

/** A write refused because someone else's went first. */
const STALE_STATUS = 409;

/**
 * How long an exchange may sit open before this device gives up on it.
 *
 * Long enough that an ordinary slow-mobile round trip is never mistaken for a
 * dead connection — a captive portal's own redirect page can take several
 * seconds, and a weak-signal 3G request routinely does too. Short enough that
 * a truly half-open connection (the case this exists for: a socket that will
 * never answer at all) does not leave `status` stuck at `'loading'` for
 * minutes. `ask()` treats a timeout exactly like any other dropped request —
 * there is nothing this device can tell the two apart, and nothing it needs
 * to.
 */
const REQUEST_TIMEOUT_MS = 10_000;

const BEHIND_MESSAGE = 'This device was behind, so it reloaded your newer data.';

/**
 * What this device knows about the household's document between visits: whose
 * it is, how far it has got, and whether it is holding anything unsent.
 */
export type SyncRecord = {
	householdId: string;
	version: number;
	dirty: boolean;
	/**
	 * A write that left this device and was never answered, and `null` when
	 * there is none. Written before the request goes out, because the case it
	 * exists for is the one where nothing comes back.
	 */
	outstanding: OutstandingWrite | null;
};

export type SyncStatus =
	| 'idle'
	| 'loading'
	| 'saving'
	| 'waiting'
	| 'stale'
	| 'error'
	/** The account's document was written by a newer build than this one. */
	| 'outdated'
	/**
	 * The document has outgrown what the server will accept. Nothing is lost and
	 * nothing is pruned; it simply stops leaving the device until it is smaller.
	 * Not a latch: see `push()`.
	 */
	| 'too-large';

/** The document as both a read and a refused write hand it back. */
type RemoteDocument = { version: number; body: Record<string, unknown> | null };

/**
 * Why an exchange produced no document: nothing arrived, or what arrived was not
 * one. Bare strings rather than a tagged object, so there is no shape a caller
 * can read past.
 */
type NoDocument = 'unreachable' | 'refused';

type ReadOutcome = RemoteDocument | NoDocument;

/**
 * A write answers with a version too; `stale` says whose it is. `'too-large'` is
 * a refusal like the others, told apart because it is the only one that says
 * something true about this device's own document rather than about the
 * request — see `state-size.ts`.
 */
type WriteOutcome = ({ stale: boolean } & RemoteDocument) | NoDocument | 'too-large';

/**
 * What an adoption puts into the store, bundled rather than positional:
 * `max-params` caps a function at four, and the household it belongs to is not
 * an argument any of them can afford to lose.
 */
type Adoption = {
	version: number;
	body: Record<string, unknown>;
	hadOwnWork: boolean;
	householdId: string;
};

type Answer = { status: number; body: unknown };

/**
 * The endpoint's answer: its status and its parsed body, or `null` for a request
 * that never arrived. An answer that is not JSON counts as never arriving,
 * because this endpoint only ever writes JSON — whatever produced it, a captive
 * portal or a proxy, was not the server, and nothing was learned.
 *
 * `credentials` stays at the default, which carries the session cookie.
 */
async function ask(init: RequestInit): Promise<Answer | null> {
	// A plain `setTimeout` and an `AbortController`, not `AbortSignal.timeout`:
	// the latter is not routed through the environment's timers, so a test
	// simulating a hung connection has no way to make it fire.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(resolve('/api/state'), { ...init, signal: controller.signal });
		return { status: response.status, body: (await response.json()) as unknown };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The `version` and `body` an answer names, or `null` when it names no version
 * and so is not a document at all — which is what a refusal such as a 401 looks
 * like. `?? {}` rather than a type guard: an answer that is not an object reads
 * as one with no fields, and fails the same check.
 */
function documentIn(value: unknown): RemoteDocument | null {
	const answer = (value ?? {}) as { version?: unknown; body?: unknown };
	if (!Number.isInteger(answer.version)) return null;
	return { version: answer.version as number, body: documentBody(answer.body) };
}

/**
 * A body is a document only when it is a JSON object. `null` — which is what a
 * household with nothing stored reads as — and anything else are the same
 * answer: there is nothing here to adopt.
 */
function documentBody(body: unknown): Record<string, unknown> | null {
	if (typeof body !== 'object' || Array.isArray(body)) return null;
	return body as Record<string, unknown> | null;
}

async function readRemote(): Promise<ReadOutcome> {
	const answer = await ask({ method: 'GET' });
	if (answer === null) return 'unreachable';
	return documentIn(answer.body) ?? 'refused';
}

/**
 * A stale refusal is the only one that carries information, and it answers with
 * the same fields a read does, so one adoption path serves both. A success whose
 * body names no version is treated as a refusal: the write may well have landed,
 * and the next attempt is told so by a refusal carrying exactly what it wrote.
 */
async function writeRemote(payload: string): Promise<WriteOutcome> {
	const answer = await ask({
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: payload
	});
	if (answer === null) return 'unreachable';
	const document = documentIn(answer.body);
	if (document === null) return refusedForSize(answer.body) ? 'too-large' : 'refused';
	return { stale: answer.status === STALE_STATUS, ...document };
}

/** Exactly what a write sends, built once so its size is the size measured. */
function envelope(version: number, body: StoredDocument): string {
	return JSON.stringify({ version, format: STATE_FORMAT, body });
}

/**
 * Whether this device has written a document of its own. The store only reaches
 * storage after a real change, so the key's presence is exactly "something has
 * been recorded here" — which is what decides a migration, and it asks nothing
 * about `TendState`'s shape to find out.
 */
function hasLocalDocument(): boolean {
	return typeof globalThis.localStorage?.getItem(STORAGE_KEY) === 'string';
}

function recordIn(value: unknown): SyncRecord | null {
	const record = (value ?? {}) as Partial<SyncRecord>;
	if (typeof record.householdId !== 'string' || !Number.isInteger(record.version)) return null;
	return {
		householdId: record.householdId,
		version: record.version as number,
		dirty: record.dirty === true,
		outstanding: outstandingWriteIn(record.outstanding)
	};
}

function readRecord(): SyncRecord | null {
	const raw = globalThis.localStorage?.getItem(SYNC_STORAGE_KEY);
	try {
		// A device with no record stringifies to text that JSON either reads as
		// nothing or refuses outright, and both mean the same thing here.
		return recordIn(JSON.parse(String(raw)));
	} catch {
		return null;
	}
}

export class SyncStore {
	/** What the conversation is doing, for anything that wants to show it. */
	status = $state<SyncStatus>('idle');

	/** The version this device and the server last agreed on. */
	version = $state(0);

	private readonly store: TendStore;

	/** The household being synced, and `null` when nothing is. */
	private householdId: string | null = null;

	/**
	 * Whether the store holds something the server has not accepted. Cleared as
	 * a request is built rather than when one succeeds, so a change arriving
	 * while a request is in the air is not called sent by the answer to a
	 * request that never carried it.
	 */
	private dirty = false;

	/** The household whose document has been read; `null` until a read lands. */
	private pulledFor: string | null = null;

	/**
	 * The write this device sent and never heard the answer to, and `null` when
	 * it is not holding one. Survives a reload through the sync record, which is
	 * the whole point of it: the answer that never arrived is usually the one
	 * the reload interrupted.
	 */
	private outstanding: OutstandingWrite | null = null;

	/**
	 * The size of the smallest document the server has refused this device for,
	 * and `null` while it has refused none. The whole of the size latch: nothing
	 * else stops a push, and a document that shrinks past this sends again on the
	 * next ordinary trigger. See `worthSending` in `state-size.ts`, which also
	 * says why this is not carried across a reload.
	 */
	private refusedAt: number | null = null;

	/**
	 * The exchange under way and whose it is. Every request records the household
	 * it was issued for, because "am I still signed in" is not the question an
	 * answer has to survive: signing out and straight back in as somebody else
	 * leaves a request in the air whose answer describes the previous account.
	 */
	private inFlight: { householdId: string; done: Promise<void> } | null = null;

	private retryBound = false;

	/**
	 * The fourth chance: the clock a device winds after an exchange that never
	 * reached the server, so recovering does not wait on the person noticing.
	 */
	private readonly retries = new SyncRetry(() => void this.schedule());

	constructor(store: TendStore) {
		this.store = store;
	}

	/**
	 * Begin syncing this household, after the session is known. Idempotent for
	 * the household already running, so it can sit in an effect.
	 *
	 * A record naming a different household means this device belonged to someone
	 * else: the document goes before anything is read, so the next account cannot
	 * be handed the last one's journal — nor push it to their own.
	 */
	async start(householdId: string): Promise<void> {
		if (this.householdId === householdId) return;
		this.householdId = householdId;
		this.pulledFor = null;
		// Set before the first read is even scheduled, not after it begins: the
		// schedule below defers by a microtask, and a caller that renders on the
		// state set here — such as the gate that decides between Onboarding and a
		// loading screen — must never see the household as freshly started but not
		// yet loading.
		this.status = 'loading';
		const record = readRecord();
		if (record !== null && record.householdId !== householdId) {
			this.store.clear();
			this.version = 0;
			this.dirty = false;
			this.outstanding = null;
			this.refusedAt = null;
		} else {
			this.version = record?.version ?? 0;
			// No record and a document of its own is a device that predates sync:
			// what it holds has never been sent, whatever the absent record says.
			this.dirty = record?.dirty ?? hasLocalDocument();
			this.outstanding = record?.outstanding ?? null;
		}
		this.store.watch(() => this.changed());
		this.bindRetries();
		this.save(householdId);
		await this.schedule();
	}

	/**
	 * Stop syncing. The document stays on the device; only signing out empties
	 * it. The watcher is left in place: `changed()` reaches nothing while there
	 * is no household, and a stopped module has no teardown to get wrong.
	 */
	stop(): void {
		this.householdId = null;
		this.dirty = false;
		this.version = 0;
		this.outstanding = null;
		this.refusedAt = null;
		this.status = 'idle';
	}

	/**
	 * Send everything outstanding and say whether the server now has it. What
	 * `AccountMenu` asks before it signs out, so unsent changes are a question
	 * rather than a silent loss.
	 */
	async flush(): Promise<boolean> {
		await this.schedule();
		return !this.dirty;
	}

	/** Signing out: stop, and leave nothing of this account on the device. */
	forget(): void {
		this.stop();
		this.store.clear();
		globalThis.localStorage?.removeItem(SYNC_STORAGE_KEY);
	}

	/**
	 * A local change: outstanding until a write carrying it has been accepted.
	 *
	 * A stopped module ignores them. The watcher stays installed for the life of
	 * the store — there is no teardown to get wrong that way — so this is where a
	 * device that has signed out stops counting what it writes as unsent.
	 */
	private changed(): void {
		const householdId = this.householdId;
		if (householdId === null) return;
		this.dirty = true;
		this.save(householdId);
		this.retry();
	}

	/**
	 * Try now, on news from outside the exchange: the network back, the page in
	 * view, something new to send. Each of those is a reason to believe the last
	 * failure is over, so the timed steps start again from the top rather than
	 * the change somebody has just recorded inheriting the ladder an earlier one
	 * already spent.
	 */
	private retry(): void {
		this.retries.reset();
		void this.schedule();
	}

	/**
	 * Three of the four moments a device that could not reach the server gets
	 * another chance; `settle()` below is the fourth, and the only one that does
	 * not wait on the world outside the app. Bound once and never removed:
	 * `schedule()` does nothing while nothing is being synced, so there is no
	 * teardown and no window in which a listener is missing.
	 */
	private bindRetries(): void {
		if (this.retryBound) return;
		if (typeof globalThis.addEventListener !== 'function') return;
		this.retryBound = true;
		globalThis.addEventListener('online', () => this.retry());
		globalThis.addEventListener('visibilitychange', () => {
			if (globalThis.document.visibilityState === 'visible') this.retry();
		});
	}

	/**
	 * One exchange at a time per household. `Promise.resolve().then` defers the
	 * work by a microtask so `inFlight` is set before it starts, and anything
	 * raised while it runs waits on the same promise rather than opening a second
	 * one.
	 *
	 * Only for the same household, though. An exchange left over from the account
	 * that has just signed out is not this account's read, and waiting on it
	 * would leave the new one having never read its own document while believing
	 * it had.
	 */
	private schedule(): Promise<void> {
		const householdId = this.householdId;
		if (householdId === null) return Promise.resolve();
		if (this.inFlight !== null && this.inFlight.householdId === householdId) {
			return this.inFlight.done;
		}
		const done: Promise<void> = Promise.resolve()
			.then(() => this.drain(householdId))
			.then(() => this.settle())
			.finally(() => {
				// Only while it is still the current one: an exchange the next
				// account replaced must not clear that account's handle on its way
				// out.
				if (this.inFlight?.done === done) this.inFlight = null;
			});
		this.inFlight = { householdId, done };
		return done;
	}

	/**
	 * What the exchange just finished leaves behind: another attempt on the
	 * clock, or nothing.
	 *
	 * Two things are outstanding. A document the server has not accepted leaves
	 * `'waiting'`, which is the status an unanswered read or write both end at
	 * and the only status that means the server was not reached. And a household
	 * this device has never read is one whose document it has not got, whether or
	 * not it is holding anything of its own — the read that never landed is worth
	 * making again.
	 *
	 * Everything else is either finished or latched, and the latches are the
	 * reason this asks the state rather than every failure site: a device the
	 * server refused, a document written by a newer build, and a document this
	 * build could not read all leave the household read and the status somewhere
	 * other than `'waiting'`. None of them arms anything, which is what stops a
	 * latched device pushing over a document it must not touch.
	 *
	 * A document refused for its size is in that group too, and for a plainer
	 * reason: no amount of asking again makes it smaller, so a clock would only
	 * spend somebody's battery. It is the one of them that is not a latch — the
	 * next local change or visit tries again, and `push()` sends the moment the
	 * document has shrunk past the size that was refused.
	 *
	 * Nothing here takes an attempt off the clock, because nothing can be on it:
	 * an attempt is only ever armed by the exchange before this one, and every
	 * other way of opening an exchange goes through `retry()`, which clears the
	 * clock on its way past. A device that has stopped is the one loose end — it
	 * can leave a last attempt armed, and that attempt reaches a `schedule()`
	 * with nothing to sync and dies there, the same way the listeners above do.
	 */
	private settle(): void {
		if (this.status === 'waiting' || this.pulledFor !== this.householdId) this.retries.arm();
	}

	/**
	 * A read if this household has not been read yet, then one send, then one
	 * more for a change that arrived while that send was in the air. Anything
	 * later stays marked dirty and rides the next trigger, so this is bounded
	 * rather than a loop a fast writer could spin.
	 */
	private async drain(householdId: string): Promise<void> {
		if (this.pulledFor !== householdId) await this.pull(householdId);
		// A read that never landed — or one that answered for a household this
		// device has since left — leaves this household unread, and writing from
		// a version it only guessed at is what the version check exists to
		// prevent. Compared against the household this exchange was opened for,
		// so it is this rule that stops it rather than a coincidence of nulls.
		if (this.pulledFor !== householdId) return;
		// A device the read was refused for is not one a write will be accepted
		// from either, and a household whose document was written by a newer build
		// is one this device must not offer its own to. `'outdated'` is the latch
		// as well as the notice: nothing clears it but starting another household,
		// which is the only thing that could make it untrue.
		if (this.status === 'error' || this.isOutdated()) return;
		// A device that could not read its own document reads but never writes.
		// The store is holding an empty state in place of data it did not
		// understand, and sending that would put the empty one on the account —
		// where every other device would then adopt it. Reading is still worth
		// doing: a document this build can read replaces the one it could not, and
		// that is what clears the refusal.
		if (this.store.refusal !== null) return;
		// One send, and one more only when that one was accepted and a change
		// arrived while it was in the air. A refusal or a dropped connection
		// waits for a trigger rather than being hammered.
		// A device that signed out while the send was in the air never gets here:
		// `changed()` stops counting its writes, so there is nothing newer to
		// send and the emptied store is never offered to the account just left.
		if (this.dirty && (await this.push(householdId))) await this.push(householdId);
	}

	/**
	 * Read the household's document. The household counts as read whether it
	 * answered with a document or refused this device — a refusal is about the
	 * device, not the document, and asking again at once would only be refused
	 * again — but not when nothing arrived at all.
	 */
	private async pull(householdId: string): Promise<void> {
		this.status = 'loading';
		const result = await readRemote();
		// Signed out — or signed in as somebody else — while this was in the air.
		// The answer describes a household that is no longer the one on this
		// device, so nothing in it is this device's business any more, and it
		// leaves the household that is here unread rather than falsely read.
		if (this.householdId !== householdId) return;
		if (result === 'unreachable') {
			this.status = this.dirty ? 'waiting' : 'idle';
			return;
		}
		this.pulledFor = householdId;
		if (result === 'refused') {
			this.status = 'error';
			return;
		}
		this.receive(result, this.dirty || hasLocalDocument(), householdId);
	}

	/**
	 * Send the document. `true` means it was accepted and a change arrived while
	 * it was in the air, so there is something newer still to send. `again` is
	 * false for the one extra attempt a refusal can earn, so a server that
	 * refuses cannot be talked into an unbounded exchange.
	 *
	 * A document already known to be too large is the one case that sends nothing
	 * at all.
	 */
	private async push(householdId: string, again = true): Promise<boolean> {
		const body = storedDocument($state.snapshot(this.store.state));
		const payload = envelope(this.version, body);
		// Nothing has left this device since the server refused a document this
		// size, and a document only grows, so this one would be refused too. It
		// stays here, still counted as unsent, rather than costing several
		// megabytes of somebody's mobile data to be told what is already known.
		// The measure is the payload's code units, not its bytes: it is only ever
		// compared with another measurement of the same kind, never with the
		// server's ceiling.
		if (!worthSending(this.refusedAt, payload.length)) {
			this.status = 'too-large';
			return false;
		}
		this.status = 'saving';
		// Recorded before the request goes out and while the record still reads
		// dirty, because the case this covers is the one where no answer ever
		// arrives: the tab is reloaded or closed with the write in the air, and
		// the next start has to be able to recognise it. Added to whatever is
		// already unanswered rather than replacing it — a device that hears
		// nothing goes on writing, and the write that landed is as likely to be
		// an earlier one as this. See `outstanding-write.ts`.
		this.outstanding = pendingWrite(this.outstanding, this.version, fingerprint(body));
		this.save(householdId);
		this.dirty = false;
		const result = await writeRemote(payload);
		// The account this write was for is no longer the one signed in here, so
		// neither the version it created nor the document it was refused with
		// belongs to whoever is.
		if (this.householdId !== householdId) return false;
		// Every outcome that carried no document back is a bare string; only a
		// stored or refused version arrives as one.
		if (typeof result === 'string') {
			this.stalled(result, payload.length);
			return false;
		}
		if (result.stale) {
			// This write was refused, so what it carried was not stored and is
			// still unsent — whatever `receive` goes on to make of the document
			// that came back with the refusal. Adopting sets this straight back to
			// false; recognizing the document as this device's own leaves it
			// standing, and the send below is what then carries it.
			this.dirty = true;
			this.receive(result, true, householdId);
			// The refusal carried a document written by a newer build. Nothing
			// more is sent, and what this device is holding stays here.
			if (this.isOutdated()) return false;
			// Adopting leaves nothing to send, so this is one of the other two: a
			// refusal carrying no document, meaning the version written from no
			// longer exists, or one carrying a document this device itself wrote
			// and never heard about. Either way `receive` has recorded the version
			// the server does hold, and the document goes out again from there.
			if (this.dirty && again) await this.push(householdId, false);
			return false;
		}
		this.outstanding = null;
		this.version = result.version;
		this.save(householdId);
		this.status = 'idle';
		return this.dirty;
	}

	/**
	 * A write that carried nothing back, whichever of the three it was. Nothing
	 * was accepted, so nothing was sent: the store is dirty again, and the record
	 * is left as it stands, since it already says this device is holding
	 * something and is never less dirty than the store.
	 *
	 * A size refusal is the one that says something about the document rather
	 * than about the request. It is remembered, so the next trigger does not
	 * repeat a multi-megabyte upload whose answer is already known, and it is
	 * said out loud through the status — a phone that stops syncing without
	 * saying so is the whole of #282.
	 */
	private stalled(result: NoDocument | 'too-large', size: number): void {
		this.dirty = true;
		if (result === 'too-large') {
			this.refusedAt = refusedSize(this.refusedAt, size);
			this.status = 'too-large';
			return;
		}
		this.status = result === 'unreachable' ? 'waiting' : 'error';
	}

	/**
	 * Take in what the server says it holds — the one path a read and a refused
	 * write share, because a refusal answers with the fields a read does.
	 *
	 * `hadOwnWork` says whether this device is holding something of its own, and
	 * decides the announcement: an adoption that displaces real work is said out
	 * loud, while a device merely receiving the account's document for the first
	 * time is not interrupted.
	 */
	private receive(remote: RemoteDocument, hadOwnWork: boolean, householdId: string): void {
		// The server has answered, so whatever this device was still holding an
		// unheard answer for is answered now, whichever way the rest of this goes.
		const outstanding = this.outstanding;
		this.outstanding = null;
		if (remote.body === null) {
			// Nothing stored for this household. This device's document, if it has
			// one, becomes the first version; it is never emptied to match.
			this.version = remote.version;
			if (hasLocalDocument()) this.dirty = true;
			this.save(householdId);
			this.status = 'idle';
			return;
		}
		// Named once the null is behind us, so what follows reads as the document
		// it now is rather than as something that might not be there.
		const body = remote.body;
		// Before anything is adopted — and before this device's own document is
		// ever offered in place of it. A newer build wrote this one; an older one
		// cannot read it, and writing over it would destroy what it does not
		// understand.
		if (documentIsFromTheFuture(body)) {
			this.outdated(hadOwnWork);
			return;
		}
		// A version above this device's is another device's work, and adopting it
		// is what this module is for — unless it is this device's own unanswered
		// write, come back as a version it never heard about. What is on the
		// device contains that document plus everything recorded after it left,
		// so adopting there would throw the newer half away (#247).
		if (remote.version > this.version && !isOwnWrite(outstanding, remote.version, body)) {
			this.adopt({ version: remote.version, body, hadOwnWork, householdId });
			return;
		}
		// Everything else leaves the document on the device as the later copy,
		// which belongs on the server rather than the other way round: the server
		// is at or behind the version this device recorded, or ahead of it only
		// because of that write. `dirty` is left as it stands, so what is here
		// goes out from where the server actually is.
		if (remote.version < this.version) this.dirty = true;
		this.version = remote.version;
		this.save(householdId);
		this.status = 'idle';
	}

	/**
	 * Replace the document with the server's. `replace()` is silent by design, so
	 * the store's own write is not reported back as a local change and pushed
	 * straight out again.
	 */
	private adopt(taken: Adoption): void {
		if (!this.store.replace(taken.body)) {
			// A document, but not one that matches the shape this build expects.
			// It is not adopted, and this device's own is not sent over it: a
			// document nobody can account for is worth more than the guess that
			// would replace it.
			this.dirty = taken.hadOwnWork;
			this.status = 'error';
			return;
		}
		this.version = taken.version;
		this.dirty = false;
		this.save(taken.householdId);
		this.status = taken.hadOwnWork ? 'stale' : 'idle';
		if (taken.hadOwnWork) toast(BEHIND_MESSAGE);
	}

	/** Whether the conversation has stopped; see `outdated()` below. */
	private isOutdated(): boolean {
		return this.status === 'outdated';
	}

	/**
	 * The account's document was written by a newer build than this one. The
	 * conversation stops: nothing is adopted, nothing is sent, and what this
	 * device is holding is left exactly as it is and still counted as unsent.
	 * Saying so is the whole point — the alternative is a phone that quietly
	 * stops syncing, or one that overwrites data it cannot read.
	 */
	private outdated(hadOwnWork: boolean): void {
		// The status is the latch: `drain` reads it, and nothing but starting
		// another household sets it to anything else. The record on disk is not
		// touched — the last one written already says whether this device is
		// holding something, and it is never less dirty than the store.
		this.dirty = hadOwnWork;
		this.status = 'outdated';
		toast(OUTDATED_MESSAGE);
	}

	/**
	 * Record where this household has got to. The household is passed in rather
	 * than read off the field, so a record can only ever be written for the
	 * account whose answer produced it.
	 */
	private save(householdId: string): void {
		const record: SyncRecord = {
			householdId,
			version: this.version,
			dirty: this.dirty,
			outstanding: this.outstanding
		};
		globalThis.localStorage?.setItem(SYNC_STORAGE_KEY, JSON.stringify(record));
	}
}

export const sync = new SyncStore(tend);
