/**
 * How long a message stays up before it takes itself away.
 *
 * Four seconds, which is what svelte-sonner gave these before this replaced it.
 * Almost all of them report something that has already happened — a row logged,
 * a height saved, a session ended — and for those there is nothing to act on and
 * no reason to leave one sitting over the top of the screen past reading it.
 */
const DISMISS_AFTER_MS = 4000;

/**
 * How long a message with an action stays up.
 *
 * Four seconds is a reading budget, and one-tap logging needs more than that.
 * Tapping a row in the Recent list writes to the journal immediately, so the
 * toast is the only thing standing between a mis-tap and a wrong entry — and
 * the person who mis-tapped is looking at the list their thumb is on, not at
 * the top of the screen. They have to notice the toast, read what it claims
 * they logged, decide it is wrong, and reach up to the button, and the first of
 * those four is the one four seconds never budgeted for.
 *
 * Five seconds is half of what this used to give a snackbar with an action.
 * The toast now also carries an explicit "Dismiss" button, so someone who has
 * already decided the entry is right does not have to wait the message out,
 * and someone who mis-tapped has a button under their thumb rather than a
 * clock to beat. The toast column is `pointer-events-none` apart from its
 * buttons, so a toast that overstays still costs nothing but a glance.
 */
const DISMISS_ACTIONABLE_AFTER_MS = 5000;

/**
 * Something the toast offers to do about what it just said.
 *
 * Deliberately one button and no more. A toast is not a dialog: the moment it
 * carries more than one choice alongside its escape hatch, it is the wrong
 * place for it.
 */
type ToastAction = { readonly label: string; readonly onClick: () => void };

/**
 * A sentence waiting to be read, at most one thing to do about it, and
 * whether it also offers an explicit way to wave it off.
 *
 * `dismissible` is opt-in rather than automatic for every toast with an
 * action: a plain message already goes away on its own, and the one-tap-log
 * toasts are the only callers that need a button for "I meant to do that" as
 * well as one for "I didn't".
 *
 * It carries no identifier because it does not need one: the object is its own
 * identity, which is what keys the list and what the timer below holds on to.
 */
export type Toast = {
	readonly message: string;
	readonly action?: ToastAction | undefined;
	readonly dismissible?: boolean | undefined;
};

/** What a caller may say about a message beyond the message itself. */
export type ToastOptions = {
	readonly action?: ToastAction | undefined;
	readonly dismissible?: boolean | undefined;
};

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

	show(message: string, options?: ToastOptions): void {
		const entry: Toast = { message, action: options?.action, dismissible: options?.dismissible };
		this.items = [...this.items, entry];
		setTimeout(
			() => this.dismiss(entry),
			entry.action ? DISMISS_ACTIONABLE_AFTER_MS : DISMISS_AFTER_MS
		);
	}

	/**
	 * By identity rather than by position: several of these are in flight at
	 * once and each one's timer was armed against a list that has since moved.
	 *
	 * Idempotent on purpose. Pressing the action dismisses the toast early, and
	 * the timer that was armed when it appeared still fires afterwards against
	 * an entry the list no longer holds.
	 */
	dismiss(entry: Toast): void {
		this.items = this.items.filter((item) => item !== entry);
	}
}

export const toasts = new ToastQueue();

/**
 * Say something, briefly.
 *
 * The name and the single-argument shape are svelte-sonner's, so the twenty
 * call sites that had it changed only the module they import from, and the
 * options argument that one-tap logging needed left every one of them alone.
 */
export function toast(message: string, options?: ToastOptions): void {
	toasts.show(message, options);
}
