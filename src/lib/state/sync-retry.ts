/**
 * The clock behind a dropped request.
 *
 * `SyncStore` has three moments that give a device which could not reach the
 * server another chance — the network coming back, the page coming into view,
 * and the next local change — and every one of them waits on something outside
 * the app happening. The commonest failure has none of them: the phone is
 * awake, online and in the foreground, one request is dropped or aborted at
 * `REQUEST_TIMEOUT_MS`, and the meal or the workout just logged sits unsent
 * until the person happens to background the app and come back. This is the
 * fourth chance, the one nobody has to provide (#193).
 *
 * Four attempts, a second apart, then four, sixteen, and a minute: about eighty
 * seconds of trying, which is the window the failure this exists for lives in —
 * a lost packet on a handover between cells is gone in a second, and a
 * connection still refusing after a minute and a half is not coming back
 * because it was asked a fifth time. Past that the three events own it again,
 * and every one of them starts a new set of steps, so work recorded during a
 * long outage always gets its own four attempts rather than inheriting an
 * exhausted ladder.
 *
 * Bounded on purpose, in both directions. Nothing here ever asks faster than
 * the step it is on, so a household with several tabs open makes a handful of
 * requests between them rather than a storm; and nothing keeps a timer alive
 * waking a phone in somebody's pocket all night about a server that is down.
 */
const FIRST_DELAY_MS = 1_000;

/** The longest a step may become, however far down the steps it has got. */
const LONGEST_DELAY_MS = 60_000;

/** How many attempts one bad spell is worth. */
const ATTEMPTS = 4;

export class SyncRetry {
	private readonly attempt: () => void;

	/** Attempts made on the current bad spell, and so which step is next. */
	private made = 0;

	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(attempt: () => void) {
		this.attempt = attempt;
	}

	/**
	 * Put the next attempt on the clock, a step further out than the last, and
	 * nothing at all once this spell's attempts are spent. Whatever was already
	 * on the clock is replaced, so there is never more than one waiting however
	 * many exchanges have ended badly.
	 */
	arm(): void {
		if (this.made >= ATTEMPTS) return;
		const delay = Math.min(FIRST_DELAY_MS * 4 ** this.made, LONGEST_DELAY_MS);
		this.made += 1;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.attempt(), delay);
	}

	/**
	 * News from outside this ladder — the network back, the page in view, a
	 * change to send. Whatever is on the clock comes off it, because an attempt
	 * is being made now, and the steps start again from the top: this is a new
	 * spell, not a continuation of the one that has just been interrupted.
	 */
	reset(): void {
		clearTimeout(this.timer);
		this.made = 0;
	}
}
