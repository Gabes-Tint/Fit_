/**
 * How long a message stays up before it takes itself away.
 *
 * Four seconds, which is what svelte-sonner gave these before this replaced it.
 * Every one of them reports something that has already happened — a row logged,
 * a height saved, a session ended — so there is nothing to act on and no reason
 * to leave one sitting over the top of the screen past reading it.
 */
const DISMISS_AFTER_MS = 4000;

/**
 * A sentence waiting to be read.
 *
 * It carries no identifier because it does not need one: the object is its own
 * identity, which is what keys the list and what the timer below holds on to.
 */
type Toast = { readonly message: string };

/**
 * Lives outside the component tree for the reason `logUi` does — the sync
 * client raises these from a module with no component around it, and the log
 * sheet raises them from a dialog that is on its way closed.
 */
class ToastQueue {
	/**
	 * Oldest first, so a second message arrives under the first rather than in
	 * place of it.
	 *
	 * `$state.raw` rather than `$state`: a deep proxy hands back a different
	 * object than the one that went in, and `dismiss` below finds its entry by
	 * identity. Nothing here mutates an entry either — the list is replaced
	 * whole on both paths — so the proxy would buy reactivity nobody uses.
	 */
	items = $state.raw<Toast[]>([]);

	show(message: string): void {
		const entry: Toast = { message };
		this.items = [...this.items, entry];
		setTimeout(() => this.dismiss(entry), DISMISS_AFTER_MS);
	}

	/**
	 * By identity rather than by position: several of these are in flight at
	 * once and each one's timer was armed against a list that has since moved.
	 */
	dismiss(entry: Toast): void {
		this.items = this.items.filter((item) => item !== entry);
	}
}

export const toasts = new ToastQueue();

/**
 * Say something, briefly.
 *
 * The name and the shape are svelte-sonner's, so the twenty call sites that had
 * it changed only the module they import from.
 */
export function toast(message: string): void {
	toasts.show(message);
}
