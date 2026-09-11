import type { normalizeBox2Probe } from '$lib/domain/workflow-box2-mechanic-rerun';
import { describe, it, expect } from 'vitest';

describe('normalizeBox2Probe', () => {
	it('trims whitespace from both ends, converts to lowercase, and prefixes with probe:', async () => {
		const fn: typeof normalizeBox2Probe = (await import('$lib/domain/workflow-box2-mechanic-rerun'))
			.normalizeBox2Probe;
		expect(fn(' Ready ')).toBe('probe:ready');
	});

	it('handles mixed case input', async () => {
		const fn: typeof normalizeBox2Probe = (await import('$lib/domain/workflow-box2-mechanic-rerun'))
			.normalizeBox2Probe;
		expect(fn('MIXED Case')).toBe('probe:mixed case');
	});
});
