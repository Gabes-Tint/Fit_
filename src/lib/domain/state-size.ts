/**
 * How much of the household's document may cross the wire, and what is supposed
 * to happen when it no longer fits.
 *
 * The document is the whole store — every meal, weight and session the account
 * has ever recorded — and it only ever grows: about 1.24 MB per logged year, a
 * number `bun run perf:sync-payload` measures from committed fixtures. So this
 * is not a limit a caller can respect by sending less. It is a wall an ordinary
 * account walks into after enough years, and everything here exists so that
 * walking into it is visible and recoverable rather than a phone that quietly
 * stops syncing. Nothing is ever pruned to fit: the data on the device is the
 * only copy, and dropping some of it to make the rest fit is the one outcome
 * worse than not syncing (#282).
 *
 * The ceiling lives here rather than beside the endpoint that enforces it
 * because three layers have to agree on it — the endpoint refuses a body over
 * it, the service unit's `BODY_SIZE_LIMIT` has to be at least it or the
 * transport kills the request first, and the payload instrument reports how far
 * a real account is from it. Two of those disagreed for a year, which is what
 * #282 turned out to be, so the number is stated once.
 */

/**
 * The largest `PUT /api/state` body the server will read, envelope included.
 *
 * 4 MiB is a little over three years of an account that eats and trains. It is
 * a memory budget as much as a policy: the server holds the text, the parsed
 * object and the re-serialized text at once, so this is what one write costs
 * it at worst. Raising it is a one-line change with a measurement behind it;
 * `scripts/deploy/body-size-limit.spec.ts` makes sure the transport is raised
 * with it.
 */
export const MAX_STATE_BODY_BYTES = 4 * 1024 * 1024;

/**
 * What an `invalid-body` refusal carries when the body was refused for its size
 * and nothing else.
 *
 * A size refusal is the only one a correct, up-to-date device can earn, and the
 * only one that says something the person could act on — so it is told apart
 * from a malformed body on the wire rather than in a log. It travels as the
 * existing code's `reason` rather than as a new code, so a client that has
 * never heard of it behaves exactly as it did.
 */
export const TOO_LARGE_REASON = 'too-large';

/** What the app says about it. Nothing is lost, and that is the first thing said. */
export const TOO_LARGE_MESSAGE =
	'Your data has outgrown what the server accepts, so it is not being sent. It is still saved on this device — export a backup from the You page.';

/**
 * Whether this answer is the size refusal. Both halves are checked: a `reason`
 * on some other code is another endpoint's word, not this one.
 */
export function refusedForSize(body: unknown): boolean {
	const error = (body as { error?: unknown } | null | undefined)?.error;
	if (typeof error !== 'object' || error === null) return false;
	const named = error as { code?: unknown; reason?: unknown };
	return named.code === 'invalid-body' && named.reason === TOO_LARGE_REASON;
}

/**
 * Whether a document this size is worth offering, given the smallest one the
 * server has refused this device for its size.
 *
 * The recovery rule, and the reason a size refusal is not a latch. A document
 * at or above a size already refused would only be refused again, so it is not
 * sent — that is what stops a phone uploading four megabytes over mobile data
 * every time a meal is logged. Anything smaller is offered, because the only
 * thing that could have changed is the one thing that matters: a document that
 * shrank, by a profile removed or entries deleted, syncs again by itself with
 * nobody having to know why it stopped.
 *
 * `refusedAt` is deliberately not remembered across a reload. A device starting
 * fresh asks once and finds out, which is right when the ceiling it ran into
 * belongs to a server that may have been raised since.
 */
export function worthSending(refusedAt: number | null, size: number): boolean {
	return refusedAt === null || size < refusedAt;
}

/**
 * The smallest size known to be refused, after one more refusal at `size`.
 * Smallest rather than latest: anything at or above a refused size is refused
 * too, and a device that shrank its document and was refused again has learned
 * a tighter bound, not a looser one.
 */
export function refusedSize(refusedAt: number | null, size: number): number {
	return refusedAt === null ? size : Math.min(refusedAt, size);
}
