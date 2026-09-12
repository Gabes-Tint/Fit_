import { describe, it, expect } from 'vitest';

type SlugifyProbeModule = {
	slugifyProbe: (value: string) => string;
};

describe('slugifyProbe', () => {
	it('converts a title with mixed case, spaces, and punctuation to lowercase with dashes', async () => {
		const { slugifyProbe } =
			(await import('$lib/domain/workflow-box4-slugify')) as SlugifyProbeModule;
		expect(slugifyProbe('  Hello,  Fit_ World! ')).toBe('hello-fit-world');
	});

	it('returns "probe" for all-invalid input', async () => {
		const { slugifyProbe } =
			(await import('$lib/domain/workflow-box4-slugify')) as SlugifyProbeModule;
		expect(slugifyProbe('???')).toBe('probe');
	});

	it('returns "probe" for empty input', async () => {
		const { slugifyProbe } =
			(await import('$lib/domain/workflow-box4-slugify')) as SlugifyProbeModule;
		expect(slugifyProbe('')).toBe('probe');
	});

	it('preserves numbers and lowercases letters', async () => {
		const { slugifyProbe } =
			(await import('$lib/domain/workflow-box4-slugify')) as SlugifyProbeModule;
		expect(slugifyProbe('Test123ABC')).toBe('test123abc');
	});

	it('collapses multiple consecutive special characters into a single dash', async () => {
		const { slugifyProbe } =
			(await import('$lib/domain/workflow-box4-slugify')) as SlugifyProbeModule;
		expect(slugifyProbe('hello---world')).toBe('hello-world');
	});

	it('trims leading and trailing dashes', async () => {
		const { slugifyProbe } =
			(await import('$lib/domain/workflow-box4-slugify')) as SlugifyProbeModule;
		expect(slugifyProbe('-hello-world-')).toBe('hello-world');
	});
});
