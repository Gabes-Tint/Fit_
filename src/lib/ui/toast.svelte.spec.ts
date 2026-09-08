import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toasts } from './toast.svelte';

/** What `AppShell`'s toaster would be showing, in the order it shows it. */
function onScreen(): string[] {
	return toasts.items.map(({ message }) => message);
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
