import { describe, it, expect } from 'vitest';

describe('trainingAuditSummary', () => {
	async function getTrainingAuditSummary() {
		// https://github.com/Gabes-Tint/Fit_/issues/370
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		return (await import('$lib/domain/trainingAuditSummary')).trainingAuditSummary as (
			name: string,
			rounds: number
		) => string;
	}

	it('should trim whitespace from name and format correctly', async () => {
		const trainingAuditSummary = await getTrainingAuditSummary();
		const result = trainingAuditSummary('  Test Name  ', 5);
		expect(result).toBe('Test Name · 5 rounds');
	});

	it('should return correct format with single round', async () => {
		const trainingAuditSummary = await getTrainingAuditSummary();
		const result = trainingAuditSummary('Training', 1);
		expect(result).toBe('Training · 1 rounds');
	});

	it('should return correct format with multiple rounds', async () => {
		const trainingAuditSummary = await getTrainingAuditSummary();
		const result = trainingAuditSummary('Audit', 10);
		expect(result).toBe('Audit · 10 rounds');
	});

	it('should reject empty names', async () => {
		const trainingAuditSummary = await getTrainingAuditSummary();
		expect(() => trainingAuditSummary('', 5)).toThrow();
	});

	it('should reject whitespace-only names', async () => {
		const trainingAuditSummary = await getTrainingAuditSummary();
		expect(() => trainingAuditSummary('   ', 5)).toThrow();
	});

	it('should reject rounds below 1', async () => {
		const trainingAuditSummary = await getTrainingAuditSummary();
		expect(() => trainingAuditSummary('Test', 0)).toThrow();
		expect(() => trainingAuditSummary('Test', -1)).toThrow();
	});
});
