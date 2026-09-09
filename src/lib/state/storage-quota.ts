/**
 * The browser's own wall, and what the app says when it hits it.
 *
 * `state-size.ts` covers the server's 4 MiB ceiling; this covers the one that
 * arrives first. Browsers cap `localStorage` per origin at around 5 MB, and
 * Chrome counts UTF-16 code units rather than bytes, so a document still inside
 * the server's limit can already be too big for the device holding it.
 * `setItem` says so by throwing, and an unguarded write carries that throw out
 * into whichever tap triggered it — a logged meal ending in a stack trace
 * instead of a sentence (#300).
 *
 * Nothing here prunes. What is on the device is the only copy of whatever was
 * recorded offline, and dropping some of it so the rest fits is the outcome
 * `state-size.ts` already rules out, for the same reason.
 */

/**
 * The two names a full device answers with: `QuotaExceededError` is what the
 * standard says and what Chrome and Safari throw, and Firefox has thrown
 * `NS_ERROR_DOM_QUOTA_REACHED` since long before there was a standard to
 * follow. Matched on the name rather than on a `code` of 22 against 1014,
 * which is the same distinction spelled less legibly.
 */
const QUOTA_ERROR_NAMES = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];

/**
 * Whether a thrown value is a storage write refused for want of room.
 *
 * Deliberately narrow, and it has to be: this predicate decides whether a
 * failure is reported to the person or re-thrown to the developer. A store that
 * answered `true` to everything would blame a full phone every time something
 * else broke, and would be indistinguishable from one that worked. So a
 * `TypeError` — or anything else carrying another name — goes back up the stack
 * as the bug it is.
 *
 * The name is read off whatever was thrown rather than checked against
 * `DOMException`, because the class is not portable and the name is: jsdom's
 * `DOMException` fails `instanceof Error`, an iframe's fails `instanceof
 * DOMException`, and neither says anything about whether the device is full.
 * `Object()` is what lets that read run over `null` and `undefined` too, so
 * there is no guard here that no browser would ever exercise.
 */
export function isStorageFull(error: unknown): boolean {
	const thrown = Object(error) as { name?: unknown };
	return QUOTA_ERROR_NAMES.includes(String(thrown.name));
}

/**
 * Whether this device is still able to keep the document.
 *
 * `'full'` is not a latch. It is set by a write that was refused and cleared by
 * the next one that lands, so somebody who frees room — or signs out — finds
 * the notice gone without having to be told why it went.
 */
export type StorageStatus = 'ok' | 'full';

/**
 * What the app says about a full device.
 *
 * It leads with what happened rather than with reassurance, which is the
 * opposite of `TOO_LARGE_MESSAGE`: the server refusing a document leaves it
 * safe on the phone, and the phone refusing it leaves the newest changes in
 * this tab and nowhere else. The export is the only thing anybody can do about
 * that, so it is the only thing the sentence asks for.
 */
export const STORAGE_FULL_MESSAGE =
	"This device's storage is full, so your latest changes are not saved on it. Export a backup from the You page.";
