import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { toast, toasts } from './toast.svelte';
import Toaster from './Toaster.svelte';

/** What `AppShell` passes: `TopBar`'s height, its safe area, and a gap. */
const OFFSET = 'calc(3.5rem + env(safe-area-inset-top) + 0.5rem)';

function region(): HTMLElement {
	const found = document.querySelector('[aria-live="polite"]');
	expect(found, 'the live region should be mounted whether or not it has anything in it').not.toBe(
		null
	);
	return found as HTMLElement;
}

/**
 * The action button, pressed the way the DOM sees it rather than through the
 * locator API: every test here runs on fake timers so the queue can be aged on
 * demand, and the locators wait on a clock that is not moving.
 */
function actionButton(): HTMLButtonElement | null {
	return region().querySelector('button');
}

beforeEach(() => {
	toasts.items = [];
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('Toaster', () => {
	it('mounts its live region before there is anything to announce', async () => {
		await render(Toaster, { offset: OFFSET });
		expect(region().textContent?.trim()).toBe('');
	});

	it('announces a message into that same region rather than a new one', async () => {
		await render(Toaster, { offset: OFFSET });
		const before = region();

		toast('Signed out.');
		await vi.advanceTimersByTimeAsync(0);

		expect(region()).toBe(before);
		expect(region().textContent).toContain('Signed out.');
	});

	it('shows several messages at once instead of overwriting one with the next', async () => {
		await render(Toaster, { offset: OFFSET });

		toast('Height saved.');
		toast('Energy saved.');
		await vi.advanceTimersByTimeAsync(0);

		const text = region().textContent ?? '';
		expect(text).toContain('Height saved.');
		expect(text).toContain('Energy saved.');
	});

	it('clears itself without being told to', async () => {
		await render(Toaster, { offset: OFFSET });

		toast('Dose noted.');
		await vi.advanceTimersByTimeAsync(0);
		expect(region().textContent).toContain('Dose noted.');

		await vi.advanceTimersByTimeAsync(4000);
		expect(region().textContent?.trim()).toBe('');
	});

	it('sits where the caller says, so it clears whatever is above it', async () => {
		await render(Toaster, { offset: OFFSET });
		expect(region().style.top).toBe(OFFSET);
	});

	it('does not take the taps meant for what is underneath it', async () => {
		// Tailwind is not loaded in this project, so the class is the assertion —
		// the same way `NavLink` and `FoodSearch` check theirs.
		await render(Toaster, { offset: OFFSET });
		expect(region().className).toMatch(/\bpointer-events-none\b/);
	});

	it('breaks a long sentence rather than widening the page (#152)', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Search needs a connection, and the full catalog is out of reach right now.');
		await vi.advanceTimersByTimeAsync(0);

		const box = region().firstElementChild as HTMLElement;
		expect(box.className).toMatch(/\bwrap-anywhere\b/);
		expect(box.className).toMatch(/\bmax-w-lg\b/);
	});
});

describe('a toast that can be undone', () => {
	it('gives a plain message nothing to press', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Height saved.');
		await vi.advanceTimersByTimeAsync(0);

		expect(actionButton()).toBe(null);
	});

	it('offers the action under the label the caller chose', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		expect(actionButton()?.textContent?.trim()).toBe('Undo');
	});

	it('names the button with the sentence it would undo', async () => {
		// "Undo", read out of a list of buttons with nothing around it, says
		// nothing about what would be undone. The sentence is right there on
		// screen for anyone who can see it, so the accessible name carries it.
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		expect(actionButton()?.getAttribute('aria-label')).toBe('Undo: Logged Egg to breakfast.');
	});

	it('lets the button take a tap the column around it refuses', async () => {
		// The stack is `pointer-events-none` so toasts never eat a tap meant for
		// the day underneath. The one thing in it that is meant to be tapped has
		// to opt back in, or the button is decoration.
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		expect(actionButton()?.className).toMatch(/\bpointer-events-auto\b/);
	});

	it('runs the handler when the button is pressed', async () => {
		const onClick = vi.fn();
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick } });
		await vi.advanceTimersByTimeAsync(0);

		actionButton()?.click();
		await vi.advanceTimersByTimeAsync(0);

		expect(onClick).toHaveBeenCalledOnce();
	});

	it('takes itself away once the action has been taken', async () => {
		// An undo that leaves its own toast standing reads as an undo that did
		// not take, and a second press would run the handler twice.
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		actionButton()?.click();
		await vi.advanceTimersByTimeAsync(0);

		expect(region().textContent?.trim()).toBe('');
	});

	it('stays up past the four seconds a message with nothing to do gets', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });

		await vi.advanceTimersByTimeAsync(4000);
		expect(region().textContent).toContain('Logged Egg to breakfast.');

		await vi.advanceTimersByTimeAsync(6000);
		expect(region().textContent?.trim()).toBe('');
	});
});
