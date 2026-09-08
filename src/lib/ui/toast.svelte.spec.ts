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

	it('stays up well past the four seconds a plain message gets', () => {
		// The whole point of the longer life: four seconds is a reading budget,
		// and this one has to survive noticing, reading, deciding and reaching.
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		vi.advanceTimersByTime(4000);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);

		vi.advanceTimersByTime(5999);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);
	});

	it('still takes itself away in the end', () => {
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		vi.advanceTimersByTime(10000);
		expect(onScreen()).toEqual([]);
	});

	it('does not lend its longer life to a plain message queued beside it', () => {
		// Two timers, two lengths. A plain sentence raised alongside one that can
		// be undone must not sit on the screen for ten seconds because of it.
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		toast('Height saved.');

		vi.advanceTimersByTime(4000);
		expect(onScreen()).toEqual(['Logged Egg to breakfast.']);

		vi.advanceTimersByTime(6000);
		expect(onScreen()).toEqual([]);
	});

	it('does not let a dismissed toast’s timer carry off the one that replaced it', () => {
		// Pressing the action dismisses the toast early, but the ten-second timer
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
});
