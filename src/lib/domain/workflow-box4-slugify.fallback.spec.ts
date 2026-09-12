import { describe, expect, it } from 'vitest';
import { PROBE_FALLBACK_SLUG, slugifyProbe } from './workflow-box4-slugify';

describe('slugifyProbe fallback', () => {
	it('names the slug a title with no letters or digits falls back to', () => {
		expect(PROBE_FALLBACK_SLUG).toBe('probe');
	});

	it('falls back for a title that is only whitespace', () => {
		expect(slugifyProbe('   ')).toBe(PROBE_FALLBACK_SLUG);
	});

	it('collapses separators between words to one dash', () => {
		expect(slugifyProbe('a  --  b')).toBe('a-b');
	});
});
