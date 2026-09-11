import { describe, expect, it } from 'vitest';

describe('sessionAuditCaption', () => {
	it('rejects empty names', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(() => mod.sessionAuditCaption('', 10)).toThrow();
	});

	it('rejects names with only whitespace', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(() => mod.sessionAuditCaption('   ', 10)).toThrow();
	});

	it('rejects minutes below 1', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(() => mod.sessionAuditCaption('Session', 0)).toThrow();
	});

	it('rejects negative minutes', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(() => mod.sessionAuditCaption('Session', -5)).toThrow();
	});

	it('returns correct format for valid inputs', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(mod.sessionAuditCaption('Morning Run', 30)).toBe('Morning Run · 30 min');
	});

	it('formats single minute correctly', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(mod.sessionAuditCaption('Warm-up', 1)).toBe('Warm-up · 1 min');
	});

	it('formats large minute values correctly', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(mod.sessionAuditCaption('Long Session', 120)).toBe('Long Session · 120 min');
	});

	it('preserves name casing in output', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(mod.sessionAuditCaption('MySession', 45)).toBe('MySession · 45 min');
	});

	it('handles names with special characters', async () => {
		const mod = (await import('./session-audit-caption')) as {
			sessionAuditCaption: (name: string, minutes: number) => string;
		};
		expect(mod.sessionAuditCaption('Session #1: Training', 60)).toBe(
			'Session #1: Training · 60 min'
		);
	});
});
