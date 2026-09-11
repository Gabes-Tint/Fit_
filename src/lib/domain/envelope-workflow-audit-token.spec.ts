import { describe, expect, it } from 'vitest';
import { envelopeWorkflowAuditToken } from './envelope-workflow-audit-token';

describe('envelopeWorkflowAuditToken', () => {
	it('returns a trimmed value wrapped in audit envelope', () => {
		expect(envelopeWorkflowAuditToken(' ready ')).toBe('<audit:ready>');
	});

	it('preserves inner spaces after trimming', () => {
		expect(envelopeWorkflowAuditToken('  hello world  ')).toBe('<audit:hello world>');
	});

	it('handles values without leading or trailing spaces', () => {
		expect(envelopeWorkflowAuditToken('complete')).toBe('<audit:complete>');
	});

	it('handles empty string after trimming', () => {
		expect(envelopeWorkflowAuditToken('   ')).toBe('<audit:>');
	});
});
