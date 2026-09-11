import { describe, it, expect } from 'vitest';
import { prefixWorkflowAuditToken } from './prefixWorkflowAuditToken';

describe('prefixWorkflowAuditToken', () => {
	it('trims input and prefixes with "audit:"', () => {
		expect(prefixWorkflowAuditToken(' ready ')).toBe('audit:ready');
	});

	it('returns "audit:" prefixed string for simple input', () => {
		expect(prefixWorkflowAuditToken('go')).toBe('audit:go');
	});
});
