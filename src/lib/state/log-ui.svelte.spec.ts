import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logUi } from './log-ui.svelte';

beforeEach(() => {
	logUi.open = false;
	logUi.tab = 'search';
	logUi.meal = null;
});

describe('logUi', () => {
	it('is closed, on the search tab, with no meal, before anything asks it to open', async () => {
		vi.resetModules();
		const fresh = await import('./log-ui.svelte');
		expect(fresh.logUi.open).toBe(false);
		expect(fresh.logUi.tab).toBe('search');
		expect(fresh.logUi.meal).toBeNull();
	});

	it('opens on request', () => {
		logUi.show();
		expect(logUi.open).toBe(true);
	});

	it('opens on the way in it was asked for', () => {
		logUi.show('photo');
		expect(logUi.tab).toBe('photo');
	});

	it('falls back to search when no way in is named', () => {
		logUi.show('scan');
		logUi.open = false;
		logUi.show();
		expect(logUi.tab).toBe('search');
	});

	it('sets the meal alongside the tab when both are named', () => {
		logUi.show('search', 'lunch');
		expect(logUi.tab).toBe('search');
		expect(logUi.meal).toBe('lunch');
	});

	it('clears a previous meal when show is called again without one', () => {
		logUi.show('search', 'lunch');
		logUi.show();
		expect(logUi.meal).toBeNull();
	});
});
