import { describe, it, expect } from 'vitest';

describe('slugifyProbe', () => {
	it('lowercases and replaces special characters with single dash', async () => {
		const module = (await import('$lib/domain/workflow-box4-slugify')) as {
			slugifyProbe: (value: string) => string;
		};
		expect(module.slugifyProbe('  Hello,  Fit_ World! ')).toBe('hello-fit-world');
	});

	it('returns "probe" for strings with only special characters', async () => {
		const module = (await import('$lib/domain/workflow-box4-slugify')) as {
			slugifyProbe: (value: string) => string;
		};
		expect(module.slugifyProbe('???')).toBe('probe');
	});

	it('returns "probe" for empty strings', async () => {
		const module = (await import('$lib/domain/workflow-box4-slugify')) as {
			slugifyProbe: (value: string) => string;
		};
		expect(module.slugifyProbe('')).toBe('probe');
	});

	it('converts runs of special characters to single dashes', async () => {
		const module = (await import('$lib/domain/workflow-box4-slugify')) as {
			slugifyProbe: (value: string) => string;
		};
		expect(module.slugifyProbe('test___multiple---dashes')).toBe('test-multiple-dashes');
	});

	it('preserves alphanumeric characters and trims surrounding dashes', async () => {
		const module = (await import('$lib/domain/workflow-box4-slugify')) as {
			slugifyProbe: (value: string) => string;
		};
		expect(module.slugifyProbe('---abc123XYZ---')).toBe('abc123xyz');
	});
});
