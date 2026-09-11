import { describe, it, expect } from 'vitest';

describe('normalizeBox2Probe', () => {
	it('trims whitespace from both ends, converts to lowercase, and prefixes with probe:', async () => {
		type NormalizeModule = { normalizeBox2Probe: (value: string) => string };
		const fn = ((await import('$lib/domain/workflow-box2-mechanic-rerun')) as NormalizeModule)
			.normalizeBox2Probe;
		expect(fn(' Ready ')).toBe('probe:ready');
	});

	it('handles mixed case input', async () => {
		type NormalizeModule = { normalizeBox2Probe: (value: string) => string };
		const fn = ((await import('$lib/domain/workflow-box2-mechanic-rerun')) as NormalizeModule)
			.normalizeBox2Probe;
		expect(fn('MIXED Case')).toBe('probe:mixed case');
	});
});
