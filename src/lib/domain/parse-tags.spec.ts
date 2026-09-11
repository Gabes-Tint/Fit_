import { describe, expect, it } from 'vitest';

describe('parseTags', () => {
	it('parses a comma-separated list of tags', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('workout,cardio,strength')).toEqual(['workout', 'cardio', 'strength']);
	});

	it('trims whitespace from each tag', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('  workout  , cardio , strength  ')).toEqual([
			'workout',
			'cardio',
			'strength'
		]);
	});

	it('removes empty entries resulting from consecutive commas', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('workout,,cardio,,,strength')).toEqual(['workout', 'cardio', 'strength']);
	});

	it('removes empty entries from trailing or leading commas', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags(',workout,cardio,')).toEqual(['workout', 'cardio']);
		expect(mod.parseTags('workout,cardio,').toString()).toBe('workout,cardio');
		expect(mod.parseTags(',workout,cardio').toString()).toBe('workout,cardio');
	});

	it('removes entries that are only whitespace', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('workout,   ,cardio,\t,strength')).toEqual([
			'workout',
			'cardio',
			'strength'
		]);
	});

	it('preserves the original order of tags', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('zebra,apple,monkey,banana')).toEqual([
			'zebra',
			'apple',
			'monkey',
			'banana'
		]);
	});

	it('deduplicates tags using first occurrence', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('workout,cardio,workout,strength,cardio')).toEqual([
			'workout',
			'cardio',
			'strength'
		]);
	});

	it('deduplicates after trimming so whitespace differences are ignored', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('workout, workout , cardio')).toEqual(['workout', 'cardio']);
	});

	it('handles an empty string by returning an empty array', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('')).toEqual([]);
	});

	it('handles a string with only commas', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags(',,,,')).toEqual([]);
	});

	it('handles a string with only whitespace', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('   ')).toEqual([]);
	});

	it('handles a single tag without commas', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		expect(mod.parseTags('workout')).toEqual(['workout']);
	});

	it('returns a typed array of strings', async () => {
		const mod = (await import('./parse-tags')) as { parseTags: (input: string) => string[] };
		const result = mod.parseTags('workout,cardio');
		expect(Array.isArray(result)).toBe(true);
		expect(typeof result[0]).toBe('string');
	});
});
