/**
 * The browser's own wall, and what the app says when it hits it.
 *
 * `state-size.ts` covers the server's 4 MiB ceiling; this covers the one that
 * arrives first. Browsers cap `localStorage` per origin at around 5 MB, and
 * Chrome counts UTF-16 code units rather than bytes, so a document still inside
 * the server's limit can be too big for the device that holds it. `setItem`
 * answers that by throwing, and an unguarded write propagates the throw into
 * whichever tap triggered it — a logged meal that vanishes with a stack trace
 * instead of a sentence (#300).
 *
 * Nothing here prunes. The device's document is the only copy of what was
 * recorded offline, and dropping some of it so the rest fits is the outcome
 * `state-size.ts` already rules out for the same reason.
 */

/**
 * Whether a thrown value is a storage write refused for want of room.
 *
 * Two names, because two browsers answer differently: `QuotaExceededError` is
 * what the standard says and what Chrome and Safari throw, and Firefox has
 * thrown `NS_ERROR_DOM_QUOTA_REACHED` since long before it was standardized.
 * Matched on `name` rather than on `instanceof DOMException` so a `code` of 22
 * against 1014 never has to be reasoned about, and so a test can raise one
 * without a browser.
 *
 * Anything else is somebody's bug and is deliberately not matched: a store that
 * swallowed every failure would hide the one case where the data really is
 * going nowhere for a reason nobody has seen yet.
 */
const QUOTA_ERROR_NAMES = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];

export function isStorageFull(error: unknown): boolean {
	const name = (error as { name?: unknown } | null | undefined)?.name;
	return QUOTA_ERROR_NAMES.includes(name as string);
}

/**
 * Whether this device is still able to keep the document.
 *
 * `'full'` is not a latch: it is set by a write that was refused and cleared by
 * the next one that lands, so a person who frees room finds the notice gone
 * without having to know why it was there.
 */
export type StorageStatus = 'ok' | 'full';

/**
 * What the app says about a full device. It leads with what happened rather
 * than with reassurance, because unlike the server's ceiling this one does mean
 * the newest changes are held nowhere but this tab — closing it is the thing to
 * not do first.
 */
export const STORAGE_FULL_MESSAGE =
	"This device's storage is full, so your latest changes are not saved on it. Export a backup from the You page before closing the app.";
