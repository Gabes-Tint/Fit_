import { describe, expect, it } from 'vitest';

describe('markWorkflowAuditToken', () => {
	it('returns "marked:" prefix plus trimmed value', async () => {
		const mod = (await import('./markWorkflowAuditToken')) as {
			markWorkflowAuditToken: (value: string) => string;
		};
		expect(mod.markWorkflowAuditToken(' ready ')).toBe('marked:ready');
	});

	it('trims leading whitespace from input', async () => {
		const mod = (await import('./markWorkflowAuditToken')) as {
			markWorkflowAuditToken: (value: string) => string;
		};
		expect(mod.markWorkflowAuditToken('  hello')).toBe('marked:hello');
	});

	it('trims trailing whitespace from input', async () => {
		const mod = (await import('./markWorkflowAuditToken')) as {
			markWorkflowAuditToken: (value: string) => string;
		};
		expect(mod.markWorkflowAuditToken('hello  ')).toBe('marked:hello');
	});

	it('handles text without whitespace', async () => {
		const mod = (await import('./markWorkflowAuditToken')) as {
			markWorkflowAuditToken: (value: string) => string;
		};
		expect(mod.markWorkflowAuditToken('ready')).toBe('marked:ready');
	});

	it('preserves internal spacing while trimming edges', async () => {
		const mod = (await import('./markWorkflowAuditToken')) as {
			markWorkflowAuditToken: (value: string) => string;
		};
		expect(mod.markWorkflowAuditToken('  hello world  ')).toBe('marked:hello world');
	});
});
