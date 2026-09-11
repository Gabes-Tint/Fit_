// https://github.com/Gabes-Tint/Fit_/issues/378: dynamic imports before module exists; suppressions removed once implemented
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it } from 'vitest';

type CheckpointNameResult = { valid: boolean; name?: string; reason?: string };

describe('validateCheckpointName', () => {
	it('accepts lowercase checkpoint names with letters, digits, and hyphens', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my-checkpoint-1') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(true);
		expect((result as { valid: true; name: string }).name).toBe('my-checkpoint-1');
	});

	it('accepts simple lowercase names', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('breakfast') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(true);
		expect((result as { valid: true; name: string }).name).toBe('breakfast');
	});

	it('accepts names with digits in the middle', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName(
			'day-2-checkpoint'
		) as unknown as CheckpointNameResult;
		expect(result.valid).toBe(true);
		expect((result as { valid: true; name: string }).name).toBe('day-2-checkpoint');
	});

	it('accepts names with multiple hyphens', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName(
			'my-long-checkpoint-name'
		) as unknown as CheckpointNameResult;
		expect(result.valid).toBe(true);
		expect((result as { valid: true; name: string }).name).toBe('my-long-checkpoint-name');
	});

	it('rejects empty names', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names containing only whitespace', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('   ') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names containing internal spaces', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names containing tabs', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my\tcheckpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names containing newlines', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my\ncheckpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names containing forward slashes', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my/checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names containing backslashes', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my\\checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names containing dots as path separators', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('../etc/passwd') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names beginning with a digit', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('1-checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names beginning with multiple digits', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('42backup') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names with uppercase letters', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('MyCheckpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names with mixed case', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my-Checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names with special characters', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my@checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names with underscores', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('my_checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('prevents accidentally treating an invalid name as valid through type narrowing', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('invalid name') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('allows hyphens at the start when preceded by a letter', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('a-checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(true);
		expect((result as { valid: true; name: string }).name).toBe('a-checkpoint');
	});

	it('accepts a single letter', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('a') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(true);
		expect((result as { valid: true; name: string }).name).toBe('a');
	});

	it('rejects names with leading hyphens', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('-checkpoint') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});

	it('rejects names with trailing hyphens', async () => {
		const mod = await import('./checkpoint-name');
		const result = mod.validateCheckpointName('checkpoint-') as unknown as CheckpointNameResult;
		expect(result.valid).toBe(false);
		expect((result as { valid: false; reason: string }).reason).toBeDefined();
	});
});
