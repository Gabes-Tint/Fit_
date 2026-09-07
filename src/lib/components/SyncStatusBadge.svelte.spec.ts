import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { sync } from '$lib/state/sync.svelte';
import { tend } from '$lib/state/tend.svelte';
import SyncStatusBadge from './SyncStatusBadge.svelte';

afterEach(() => {
	// `sync` and `tend` are module singletons; leaving either saying something
	// would leak into whichever test runs next.
	sync.status = 'idle';
	tend.refusal = null;
	vi.useRealTimers();
});

describe('SyncStatusBadge, quiet by default', () => {
	it('says nothing while idle', async () => {
		sync.status = 'idle';
		await render(SyncStatusBadge);
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('says nothing about a save that has not run long enough to notice', async () => {
		vi.useFakeTimers();
		sync.status = 'saving';
		await render(SyncStatusBadge);
		await vi.advanceTimersByTimeAsync(200);
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('says nothing about a background read that resolves quickly', async () => {
		vi.useFakeTimers();
		sync.status = 'loading';
		await render(SyncStatusBadge);
		await vi.advanceTimersByTimeAsync(200);
		expect(document.body.textContent?.trim()).toBe('');
	});
});

describe('SyncStatusBadge, a write not yet on the server', () => {
	it('admits a save is still open once it has run long enough to notice', async () => {
		vi.useFakeTimers();
		sync.status = 'saving';
		await render(SyncStatusBadge);
		await vi.advanceTimersByTimeAsync(500);
		expect(document.body.textContent).toContain('Saving…');
	});

	it('clears the notice once the save settles and its minimum stretch has passed', async () => {
		vi.useFakeTimers();
		sync.status = 'saving';
		await render(SyncStatusBadge);
		await vi.advanceTimersByTimeAsync(500);
		expect(document.body.textContent).toContain('Saving…');

		sync.status = 'idle';
		// The notice has a floor on how long it stays up once shown, so it does
		// not vanish the instant the save that triggered it settles.
		await vi.advanceTimersByTimeAsync(500);
		expect(document.body.textContent).toContain('Saving…');

		await vi.advanceTimersByTimeAsync(500);
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('does not strobe on a connection where each save takes about half a second', async () => {
		// Several saves in a row, each settling before the next begins, on a
		// connection slow enough to clear the notice delay but fast enough that
		// naive show/hide would flicker the notice on and off between them.
		vi.useFakeTimers();
		sync.status = 'saving';
		await render(SyncStatusBadge);

		await vi.advanceTimersByTimeAsync(500);
		expect(document.body.textContent).toContain('Saving…');

		sync.status = 'idle';
		await vi.advanceTimersByTimeAsync(100);
		sync.status = 'saving';
		// Still inside the minimum-visible stretch from the first save, and the
		// second save has begun again: the notice was never cleared to begin
		// with, so there is nothing here for a person to notice flickering.
		expect(document.body.textContent).toContain('Saving…');

		await vi.advanceTimersByTimeAsync(600);
		expect(document.body.textContent).toContain('Saving…');
	});
});

describe('SyncStatusBadge, offline with unsent changes', () => {
	it('is distinguishable from a save in flight', async () => {
		sync.status = 'waiting';
		await render(SyncStatusBadge);
		await expect.element(page.getByText(/offline/i)).toBeInTheDocument();
		expect(document.body.textContent).not.toContain('Saving…');
	});

	it('shows immediately, with no delay to let a person miss it', async () => {
		vi.useFakeTimers();
		sync.status = 'waiting';
		await render(SyncStatusBadge);
		expect(document.body.textContent).toContain('Offline');
	});
});

describe('SyncStatusBadge, a write the server refused', () => {
	it('says the save failed rather than staying silent', async () => {
		sync.status = 'error';
		await render(SyncStatusBadge);
		await expect.element(page.getByText(/couldn't reach the server/i)).toBeInTheDocument();
	});
});

describe('SyncStatusBadge, data this build cannot read', () => {
	it('tells someone to update the app when the account is ahead of it', async () => {
		sync.status = 'outdated';
		await render(SyncStatusBadge);
		await expect.element(page.getByText(/update the app/i)).toBeInTheDocument();
	});

	it('says the same when it is this device’s own saved data that is ahead', async () => {
		tend.refusal = { ok: false, reason: 'future', message: 'Update the app to load it.' };
		await render(SyncStatusBadge);
		await expect.element(page.getByText(/update the app/i)).toBeInTheDocument();
	});

	it('outranks a save in flight, because it is the reason the save is going nowhere', async () => {
		vi.useFakeTimers();
		sync.status = 'saving';
		tend.refusal = {
			ok: false,
			reason: 'malformed',
			message: 'Your saved data could not be read.'
		};
		await render(SyncStatusBadge);
		await vi.advanceTimersByTimeAsync(600);
		expect(document.body.textContent).toContain('could not be read');
		expect(document.body.textContent).not.toContain('Saving…');
	});
});

describe('SyncStatusBadge, the live region itself', () => {
	it('is present even with nothing to announce, rather than appearing only once there is', async () => {
		// A region only mounted once a message exists is a region whose first
		// message is inserted whole — the one case assistive tech is least
		// likely to announce. It must already be there, empty, from the start.
		sync.status = 'idle';
		await render(SyncStatusBadge);
		expect(page.getByRole('status').elements()).toHaveLength(1);
	});

	it('stays the one node across every state, rather than being recreated', async () => {
		vi.useFakeTimers();
		sync.status = 'idle';
		await render(SyncStatusBadge);
		const idleNode = page.getByRole('status').elements()[0];

		sync.status = 'waiting';
		await vi.advanceTimersByTimeAsync(0);
		expect(page.getByRole('status').elements()[0]).toBe(idleNode);

		sync.status = 'error';
		await vi.advanceTimersByTimeAsync(0);
		expect(page.getByRole('status').elements()[0]).toBe(idleNode);
	});

	it('sits out of document flow, so a notice appearing never shifts the content around it', async () => {
		sync.status = 'idle';
		await render(SyncStatusBadge);
		const region = page.getByRole('status').elements()[0];
		expect(region?.closest('.fixed')).not.toBeNull();
	});
});
