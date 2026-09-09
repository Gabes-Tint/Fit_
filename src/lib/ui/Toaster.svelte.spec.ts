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

/** The explicit "Dismiss" button, found by its accessible name rather than position. */
function dismissButton(): HTMLButtonElement | null {
	const found = [...region().querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === 'Dismiss'
	);
	return found ?? null;
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

	it('names the button with its plain label', async () => {
		// "Undo" sitting next to "Dismiss" reads as a pair of choices about the
		// same sentence above them, so the accessible name is the same word shown
		// on screen rather than a caller-specific sentence.
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		expect(actionButton()?.getAttribute('aria-label')).toBe(null);
		expect(actionButton()?.textContent?.trim()).toBe('Undo');
	});

	it('colors the action text with the destructive token and no fill', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		expect(actionButton()?.className).toMatch(/\btext-destructive\b/);
		expect(actionButton()?.className).not.toMatch(/\bbg-destructive\b/);
	});

	it('gives the action button the full 44px hit height', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		expect(actionButton()?.className).toMatch(/\bmin-h-11\b/);
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

		await vi.advanceTimersByTimeAsync(1000);
		expect(region().textContent?.trim()).toBe('');
	});
});

describe('a toast that offers an explicit dismiss', () => {
	it('gives an action-only toast nothing to press beyond the action', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		expect(dismissButton()).toBe(null);
	});

	it('adds a Dismiss button at the right end when the caller asks for one', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', {
			action: { label: 'Undo', onClick: () => {} },
			dismissible: true
		});
		await vi.advanceTimersByTimeAsync(0);

		const buttons = [...region().querySelectorAll('button')];
		expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Undo', 'Dismiss']);
	});

	it('gives Dismiss the toast’s own text color rather than the destructive one', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', {
			action: { label: 'Undo', onClick: () => {} },
			dismissible: true
		});
		await vi.advanceTimersByTimeAsync(0);

		expect(dismissButton()?.className).toMatch(/\btext-card-foreground\b/);
		expect(dismissButton()?.className).not.toMatch(/\btext-destructive\b/);
	});

	it('gives the Dismiss button the full 44px hit height', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', {
			action: { label: 'Undo', onClick: () => {} },
			dismissible: true
		});
		await vi.advanceTimersByTimeAsync(0);

		expect(dismissButton()?.className).toMatch(/\bmin-h-11\b/);
	});

	it('closes the toast without running the action', async () => {
		const onClick = vi.fn();
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick }, dismissible: true });
		await vi.advanceTimersByTimeAsync(0);

		dismissButton()?.click();
		await vi.advanceTimersByTimeAsync(0);

		expect(region().textContent?.trim()).toBe('');
		expect(onClick).not.toHaveBeenCalled();
	});
});

describe('a reachable toast pauses its own countdown', () => {
	it('does not disappear while the pointer is over the Undo button', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		actionButton()?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(60000);

		expect(region().textContent).toContain('Logged Egg to breakfast.');
	});

	it('picks the countdown back up, at the full five seconds, once the pointer leaves', async () => {
		// `resume` re-arms at the entry's usual length rather than tracking
		// exactly how much was left when it paused — see `toast.svelte.ts`.
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		// Four of the five seconds spent before the pointer arrives.
		await vi.advanceTimersByTimeAsync(4000);
		actionButton()?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

		// Paused for a while — none of this counts against what resume grants.
		await vi.advanceTimersByTimeAsync(10000);
		expect(region().textContent).toContain('Logged Egg to breakfast.');

		actionButton()?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(4999);
		expect(region().textContent).toContain('Logged Egg to breakfast.');

		await vi.advanceTimersByTimeAsync(1);
		expect(region().textContent?.trim()).toBe('');
	});

	it('does not disappear while the Undo button holds keyboard focus', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		actionButton()?.focus();
		await vi.advanceTimersByTimeAsync(60000);

		expect(region().textContent).toContain('Logged Egg to breakfast.');
	});

	it('resumes the countdown, at the full five seconds, once focus moves off the button', async () => {
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', { action: { label: 'Undo', onClick: () => {} } });
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(4000);
		actionButton()?.focus();

		await vi.advanceTimersByTimeAsync(10000);
		expect(region().textContent).toContain('Logged Egg to breakfast.');

		actionButton()?.blur();
		await vi.advanceTimersByTimeAsync(4999);
		expect(region().textContent).toContain('Logged Egg to breakfast.');

		await vi.advanceTimersByTimeAsync(1);
		expect(region().textContent?.trim()).toBe('');
	});

	it('pauses just as well for a pointer over the Dismiss button', async () => {
		// The same protection applies to Dismiss as to Undo: a thumb landing on
		// it is a thumb about to tap it, whichever of the two it is.
		await render(Toaster, { offset: OFFSET });
		toast('Logged Egg to breakfast.', {
			action: { label: 'Undo', onClick: () => {} },
			dismissible: true
		});
		await vi.advanceTimersByTimeAsync(0);

		dismissButton()?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(60000);

		expect(region().textContent).toContain('Logged Egg to breakfast.');
	});

	it('has no button to pause a plain message on, so it keeps its own four-second life', async () => {
		// A plain message renders neither button (see "gives a plain message
		// nothing to press" above), so there is nothing for a pointer or focus
		// to land on and pause it — its own timer runs out on schedule.
		await render(Toaster, { offset: OFFSET });
		toast('Height saved.');
		await vi.advanceTimersByTimeAsync(3999);
		expect(region().textContent).toContain('Height saved.');

		await vi.advanceTimersByTimeAsync(1);
		expect(region().textContent?.trim()).toBe('');
	});
});
