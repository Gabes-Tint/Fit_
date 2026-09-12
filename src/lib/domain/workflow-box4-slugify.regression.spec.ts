import { describe, expect, it } from 'vitest';
import { PROBE_SLUG_FALLBACK, slugifyProbe } from './workflow-box4-slugify';

describe('slugifyProbe edges', () => {
	it('returns the named fallback, not an empty string, for punctuation alone', () => {
		expect(PROBE_SLUG_FALLBACK).toBe('probe');
		expect(slugifyProbe('-_-')).toBe(PROBE_SLUG_FALLBACK);
	});

	it('drops letters outside a-z rather than transliterating them', () => {
		expect(slugifyProbe('Café Mocha')).toBe('caf-mocha');
	});

	it('leaves a title that is already a slug alone', () => {
		expect(slugifyProbe('box4-probe-2')).toBe('box4-probe-2');
	});
});
