/**
 * The writes this device sent and never heard the answer to.
 *
 * `sync.svelte.ts` records the version it last *heard* about. A write it issued
 * can move the server past that version without the answer ever arriving: the
 * request reached the server, and the tab was reloaded or closed a moment
 * later. On the next start the device finds the server ahead of it, reads that
 * as another device's work, and adopts it. What it adopts is its own document
 * from a moment ago — and everything recorded between that write leaving and
 * the reload goes with it. That is #247: a height typed and saved, gone on a
 * reload, with the store's own copy on the device having been correct the whole
 * time.
 *
 * Telling that case from a genuine one — another device really did write —
 * decides which copy survives, so it is established rather than assumed:
 * adopting is right when the newer version is somebody else's, and pushing over
 * it would lose their change. The server keeps the document opaque and records
 * no writer, so the only thing that identifies a write is what it carried. This
 * keeps a fingerprint of that, next to the version it was sent from, and
 * answers the one question: is the document the server now holds the one this
 * device sent and never heard about?
 *
 * "No" is the old behavior, and every uncertainty answers "no": a record from
 * a build whose fingerprint was computed differently, a record written before
 * this existed, a document that has moved on again since. So the worst a stale
 * or unreadable fingerprint costs is the adoption the device would have made
 * anyway.
 *
 * Writes, plural, because one is not enough. A device that hears nothing keeps
 * writing — the retry clock a second later, and whatever is logged in between —
 * and every one of those goes out from the same version, since the version only
 * moves when a write is answered. Remembering only the latest is what #247's
 * fix left open: the earlier write was the one that landed, the later one came
 * back refused with that earlier document attached, the device did not
 * recognise it, and everything logged after it left was adopted away.
 */

export type OutstandingWrite = {
	/**
	 * The version these writes were sent from. The server assigns the next one,
	 * so whichever of them landed leaves the server at exactly one past this.
	 */
	version: number;
	/**
	 * What each unanswered write carried, as `fingerprint` describes it, oldest
	 * first.
	 *
	 * A list rather than one entry, because a device holding an unheard write
	 * keeps writing. The retry clock sends again a second later, and anything
	 * logged in between goes out too — every one of them from the same version,
	 * because the version only moves when a write is *answered*. Exactly one of
	 * them can be what the server stored (the first to arrive takes the version;
	 * the rest are refused as stale), and this device cannot tell which. So it
	 * keeps them all and asks whether the document that came back is any of
	 * them.
	 */
	fingerprints: string[];
};

/**
 * How many unanswered writes are worth remembering. Reached only by a device
 * that has sent this many distinct documents from one version without a single
 * answer, which is a long outage with somebody logging throughout it. Past that
 * the newest are dropped and the oldest kept: a write that landed is one that
 * reached the server, and the later ones went out over a connection that was
 * already failing.
 */
const MOST_KEPT = 16;

/**
 * FNV-1a's two constants. The hash is not a security claim and does not need to
 * be one: nothing here is defended against a document chosen to collide, only
 * against two unrelated documents happening to agree, and it is asked exactly
 * once per start against exactly one candidate.
 */
const OFFSET_BASIS = 2166136261;
const PRIME = 16777619;

function hash(text: string): number {
	let value = OFFSET_BASIS;
	// `for...of` rather than an index: an index that counted the wrong way would
	// not end, and a mutation run scores a mutant that never returns as a timeout
	// rather than as the caught mistake it is.
	for (const character of text) {
		// `Math.imul`, not `*`: the product of two 32-bit values is past what a
		// double holds exactly, and `*` would round the low bits away in silence.
		value = Math.imul(value ^ character.charCodeAt(0), PRIME);
	}
	return value >>> 0;
}

/**
 * A short, stable name for a document's contents.
 *
 * Over `JSON.stringify`, which is what actually traveled: the server stores
 * the text it was sent and hands back the same object graph, and `JSON.parse`
 * preserves key order, so a document that made the round trip serializes to the
 * same text it was sent as. The length goes in beside the hash because it is
 * free and independent of it.
 */
export function fingerprint(body: object): string {
	const text = JSON.stringify(body);
	return `${text.length}.${hash(text)}`;
}

/**
 * The outstanding write a stored sync record names, or `null` for a record that
 * names none — which is every record written before this field existed, and
 * every record whose write has been answered.
 */
export function outstandingWriteIn(value: unknown): OutstandingWrite | null {
	const write = (value ?? {}) as Partial<OutstandingWrite> & { fingerprint?: unknown };
	if (!Number.isInteger(write.version)) return null;
	const fingerprints = fingerprintsIn(write);
	if (fingerprints.length === 0) return null;
	return { version: write.version as number, fingerprints };
}

/**
 * The names a stored record carries. A record written by the build that kept
 * one write names it under `fingerprint`, and is read as the list of one it is,
 * so upgrading does not cost a device the protection it was already holding.
 * Anything else — a list with a hole in it, a field of the wrong type — answers
 * with none, which is this module's "no".
 */
function fingerprintsIn(write: { fingerprints?: unknown; fingerprint?: unknown }): string[] {
	if (typeof write.fingerprint === 'string') return [write.fingerprint];
	if (!Array.isArray(write.fingerprints)) return [];
	// Typed as `unknown[]` first: `Array.isArray` narrows to `any[]`, and every
	// entry of an `any[]` already passes for a name without being one.
	const names: unknown[] = write.fingerprints;
	if (!names.every((print): print is string => typeof print === 'string')) return [];
	return names;
}

/**
 * Add the write about to go out to the ones still unanswered, and `null` back
 * from a version this record is not about — a version that moved is a version
 * whose writes were all answered, so nothing from it is outstanding any more.
 * A document identical to one already named adds nothing: the question this
 * answers is which documents, not how many requests.
 */
export function pendingWrite(
	current: OutstandingWrite | null,
	version: number,
	print: string
): OutstandingWrite {
	const kept = current !== null && current.version === version ? current.fingerprints : [];
	if (kept.includes(print) || kept.length >= MOST_KEPT) return { version, fingerprints: kept };
	return { version, fingerprints: [...kept, print] };
}

/**
 * Whether the document the server holds is one of this device's own unanswered
 * writes come back to it. Both halves have to agree: the server sits at exactly
 * the version those writes would have created, and what it holds is what one of
 * them carried.
 */
export function isOwnWrite(
	outstanding: OutstandingWrite | null,
	version: number,
	body: object
): boolean {
	if (outstanding === null) return false;
	if (version !== outstanding.version + 1) return false;
	return outstanding.fingerprints.includes(fingerprint(body));
}
