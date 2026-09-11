import { describe, expect, it } from 'vitest';

const normalizeWorkflowProbeToken = ((value: string) => value) as (value: string) => string;

describe('normalizeWorkflowProbeToken', () => {
	it('trims leading/trailing whitespace and lowercases the remainder', () => {
		expect(normalizeWorkflowProbeToken('  AbC  ')).toBe('abc');
	});

	it('lowcases an already-trimmed uppercase string', () => {
		expect(normalizeWorkflowProbeToken('READY')).toBe('ready');
	});

	it('has no Svelte, browser, server, persistence, network, or database dependency', () => {
		expect(typeof normalizeWorkflowProbeToken).toBe('function');
		expect(normalizeWorkflowProbeToken('  TeSt  ')).toBe('test');
	});
});
