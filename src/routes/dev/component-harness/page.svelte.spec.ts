import type { HttpError } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page';

describe('the component harness load guard', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('is reachable in the web build', () => {
		expect(load()).toBeUndefined();
	});

	it('404s inside the Capacitor build', () => {
		vi.stubEnv('VITE_CAPACITOR', 'yes');
		let thrown: unknown;
		try {
			load();
		} catch (error) {
			thrown = error;
		}
		expect((thrown as HttpError).status).toBe(404);
		expect((thrown as HttpError).body.message).toBe('Not found');
	});
});
