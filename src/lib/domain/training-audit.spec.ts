import { describe, expect, it } from 'vitest';

describe('trainingAuditSummary', () => {
	it('formats exercise name and rounds with a centered dot separator', async () => {
		const module = (await import('./training-audit')) as {
			trainingAuditSummary: (opts: { name: string; rounds: number }) => string;
		};
		expect(module.trainingAuditSummary({ name: 'Deadlift', rounds: 4 })).toBe(
			'Deadlift · 4 rounds'
		);
	});

	it('singularizes "rounds" to "round" when rounds is 1', async () => {
		const module = (await import('./training-audit')) as {
			trainingAuditSummary: (opts: { name: string; rounds: number }) => string;
		};
		expect(module.trainingAuditSummary({ name: 'Squat', rounds: 1 })).toBe('Squat · 1 round');
	});

	it('handles exercise names with spaces', async () => {
		const module = (await import('./training-audit')) as {
			trainingAuditSummary: (opts: { name: string; rounds: number }) => string;
		};
		expect(module.trainingAuditSummary({ name: 'Bench Press', rounds: 3 })).toBe(
			'Bench Press · 3 rounds'
		);
	});
});
