/**
 * The one write this device sent and never heard the answer to.
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
 */

export type OutstandingWrite = {
	/**
	 * The version the write was sent from. The server assigns the next one, so a
	 * write that landed leaves the server at exactly one past this.
	 */
	version: number;
	/** What the write carried, as `fingerprint` describes it. */
	fingerprint: string;
};

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
 * the text it was sent and hands back the same object graph, and
 * `JSON.parse` preserves key order, so a document that made the round trip
 * serializes to the same text it was sent as. The length goes in beside the
 * hash because it is free and independent of it.
 */
export function fingerprint(body: object): string {
	const text = JSON.stringify(body);
	return `${text.length.toString(36)}.${hash(text).toString(36)}`;
}

/**
 * The outstanding write a stored sync record names, or `null` for a record that
 * names none — which is every record written before this field existed, and
 * every record whose write has been answered.
 */
export function outstandingWriteIn(value: unknown): OutstandingWrite | null {
	const write = (value ?? {}) as Partial<OutstandingWrite>;
	if (!Number.isInteger(write.version) || typeof write.fingerprint !== 'string') return null;
	return { version: write.version as number, fingerprint: write.fingerprint };
}

/**
 * Whether the document the server holds is this device's own unanswered write
 * come back to it. Both halves have to agree: the server sits at exactly the
 * version that write would have created, and what it holds is what that write
 * carried.
 */
export function isOwnWrite(
	outstanding: OutstandingWrite | null,
	remote: { version: number; body: object }
): boolean {
	if (outstanding === null) return false;
	if (remote.version !== outstanding.version + 1) return false;
	return fingerprint(remote.body) === outstanding.fingerprint;
}
