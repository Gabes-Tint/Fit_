import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toasts, type Toast } from './toast.svelte';

/** What `AppShell`'s toaster would be showing, in the order it shows it. */
function onScreen(): string[] {
	return toasts.items.map(({ message }) => message);
}

/**
 * The one entry on screen, for the tests that read an entry rather than the
 * sentence in it. It throws rather than returning `undefined` so the tests
 * below can reach straight into `.action`: an empty queue would otherwise make
 * every assertion about a missing action pass for the wrong reason.
 */
function only(): Toast {
	const [entry] = toasts.items;
	if (!entry) throw new Error(`expected one toast on screen, found ${toasts.items.length}`);
	return entry;
}

beforeEach(() => {
	// A module singleton, and every test below arms timers against it, so both
	// the queue and the clock start each test where the last one found them.
	toasts.items = [];
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the toast queue', () => {
	it('has nothing to say before anything asks it to', async () => {
		// The reset above would hide a queue that started with something in it,
		// so this asks a module that has never been touched.
		vi.resetModules();
		const fresh = await import('./toast.svelte');
		expect(fresh.toasts.items).toEqual([]);
	});

	it('puts the sentence it was given on screen', () => {
		toast('Height saved.');
		expect(onScreen()).toEqual(['Height saved.']);
	});

	it('shows a second message under the first rather than in place of it', () => {
		toast('Height saved.');
		toast('Energy saved.');
		expect(onScreen()).toEqual(['Height saved.', 'Energy saved.']);
	});

	it('takes a message away once it has been up long enough to read', () => {
		toast('Dose noted.');
		vi.advanceTimersByTime(4000);
		expect(onScreen()).toEqual([]);
	});

	it('keeps a message up for the whole four seconds', () => {
		toast('Dose noted.');
		vi.advanceTimersByTime(3999);
		expect(onScreen()).toEqual(['Dose noted.']);
	});

	it('leaves the other messages alone when one of them expires', () => {
		toast('Height saved.');
		vi.advanceTimersByTime(1000);
		toast('Energy saved.');

		vi.advanceTimersByTime(3000);
		expect(onScreen()).toEqual(['Energy saved.']);

		vi.advanceTimersByTime(1000);
		expect(onScreen()).toEqual([]);
	});

	it('gives two identical sentences a life each', () => {
		// Two saves in a row say the same thing, and the second one must not be
		// carried off by the first one's timer — nor keep the first one up.
		toast('Energy saved.');
		vi.advanceTimersByTime(1000);
		toast('Energy saved.');

		vi.advanceTimersByTime(3000);
		expect(onScreen()).toEqual(['Energy saved.']);

		vi.advanceTimersByTime(1000);
		expect(onScreen()).toEqual([]);
	});
});

describe('a toast with something to do about it', () => {
	it('says nothing about an action when the caller offered none', () => {
		// The twenty call sites that predate one-tap logging all pass a sentence
		// and nothing else, and none of them should start growing a button.
		toast('Height saved.');
		expect(only().action).toBeUndefined();
	});

	it('carries the label and the handler the caller gave it', () => {
		const onClick = vi.fn();
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick } });

		expect(only().action?.label).toBe('Undo');
		only().action?.onClick();
		expect(onClick).toHaveBeenCalledOnce();
	});

	it('stays up past the four seconds a plain message gets', () => {
		// The whole point of the longer life: four seconds is a reading budget,
		// and this one has to survive noticing, reading, deciding and reaching.
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		vi.advanceTimersByTime(4000);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);

		vi.advanceTimersByTime(999);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);
	});

	it('still takes itself away in the end', () => {
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		vi.advanceTimersByTime(5000);
		expect(onScreen()).toEqual([]);
	});

	it('does not lend its longer life to a plain message queued beside it', () => {
		// Two timers, two lengths. A plain sentence raised alongside one that can
		// be undone must not sit on the screen for five seconds because of it.
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		toast('Height saved.');

		vi.advanceTimersByTime(4000);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);

		vi.advanceTimersByTime(1000);
		expect(onScreen()).toEqual([]);
	});

	it('does not let a dismissed toast’s timer carry off the one that replaced it', () => {
		// Pressing the action dismisses the toast early, but the five-second timer
		// armed when it appeared still fires afterwards. By then the list has
		// moved on, and the entry at that position belongs to someone else.
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		toasts.dismiss(only());

		vi.advanceTimersByTime(7000);
		toast('Removed.');

		vi.advanceTimersByTime(3000);
		expect(onScreen()).toEqual(['Removed.']);

		vi.advanceTimersByTime(1000);
		expect(onScreen()).toEqual([]);
	});

	it('says nothing about being dismissible when the caller did not ask for it', () => {
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		expect(only().dismissible).toBeUndefined();
	});

	it('carries the dismissible flag the caller gave it', () => {
		toast('Logged Egg to breakfast.', {
			action: { label: 'Undo', onClick: () => {} },
			dismissible: true
		});
		expect(only().dismissible).toBe(true);
	});
});

describe('pausing the countdown a pointer or focus has landed on', () => {
	it('does not take a paused toast away, however long it is paused for', () => {
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		toasts.pause(only());

		vi.advanceTimersByTime(60000);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);
	});

	it('takes it away after the remaining time once resumed', () => {
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		const entry = only();

		// Two of the five seconds spent before the pointer arrives.
		vi.advanceTimersByTime(2000);
		toasts.pause(entry);

		// Paused for a while — none of this counts against the three seconds left.
		vi.advanceTimersByTime(10000);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);

		toasts.resume(entry);
		vi.advanceTimersByTime(2999);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);

		vi.advanceTimersByTime(1);
		expect(onScreen()).toEqual([]);
	});

	it('is a no-op on a toast with nothing armed', () => {
		// A dismissed entry's timer is already gone; pausing or resuming it must
		// not throw, and must not resurrect it.
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		const entry = only();
		toasts.dismiss(entry);

		expect(() => toasts.pause(entry)).not.toThrow();
		expect(() => toasts.resume(entry)).not.toThrow();
		expect(onScreen()).toEqual([]);
	});

	it('lets a second pause and resume run against the time still left, not the whole five seconds', () => {
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		const entry = only();

		vi.advanceTimersByTime(1000);
		toasts.pause(entry);
		toasts.resume(entry);
		// One second gone, four left — pausing and resuming immediately must not
		// have reset the clock back to the full five.
		vi.advanceTimersByTime(1000);
		toasts.pause(entry);
		toasts.resume(entry);

		vi.advanceTimersByTime(2999);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);

		vi.advanceTimersByTime(1);
		expect(onScreen()).toEqual([]);
	});

	it('drops the timer record on dismiss, so a stray resume afterwards cannot re-arm it', () => {
		// `resume` after `dismiss` is already covered as a no-op above, but a
		// no-op is also what happens with nothing left to prove it: if `dismiss`
		// kept the record around instead of dropping it, `resume` would find it
		// and schedule a fresh timeout that calls `dismiss` a second time. The
		// spy is what tells the two apart — `clearAllTimers` first, so the
		// original five-second timer `show` armed (which nothing here cancels,
		// by design: `dismiss` is idempotent precisely because that timer still
		// fires later) does not also call it and confound the count.
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		const entry = only();
		const dismissSpy = vi.spyOn(toasts, 'dismiss');

		toasts.dismiss(entry);
		vi.clearAllTimers();
		toasts.resume(entry);
		vi.advanceTimersByTime(60000);

		expect(dismissSpy).toHaveBeenCalledTimes(1);
	});
});
