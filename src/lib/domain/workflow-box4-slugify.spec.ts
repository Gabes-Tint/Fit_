import { describe, it, expect, beforeAll } from 'vitest';

type SlugifyProbeModule = {
	slugifyProbe: (value: string) => string;
};

describe('slugifyProbe', () => {
	let slugifyProbe: (value: string) => string;

	beforeAll(async () => {
		const module = (await import('$lib/domain/workflow-box4-slugify')) as SlugifyProbeModule;
		slugifyProbe = module.slugifyProbe;
	});

	it('converts a title with mixed case, spaces, and punctuation to lowercase with dashes', () => {
		expect(slugifyProbe('  Hello,  Fit_ World! ')).toBe('hello-fit-world');
	});

	it('returns "probe" for all-invalid input', () => {
		expect(slugifyProbe('???')).toBe('probe');
	});

	it('returns "probe" for empty input', () => {
		expect(slugifyProbe('')).toBe('probe');
	});

	it('preserves numbers and lowercases letters', () => {
		expect(slugifyProbe('Test123ABC')).toBe('test123abc');
	});

	it('collapses multiple consecutive special characters into a single dash', () => {
		expect(slugifyProbe('hello---world')).toBe('hello-world');
	});

	it('trims leading and trailing dashes', () => {
		expect(slugifyProbe('-hello-world-')).toBe('hello-world');
	});
});
