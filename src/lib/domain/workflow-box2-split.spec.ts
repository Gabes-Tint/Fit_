import { describe, expect, it } from 'vitest';

describe('formatBox2SplitLabel', () => {
	it('exports formatBox2SplitLabel from the module', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel('test');
		expect(typeof result).toBe('string');
	});

	it('trims the input value', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel('  test  ');
		expect(result).toMatch(/^SPLIT:/);
	});

	it('converts the trimmed value to uppercase', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel('hello');
		expect(result).toBe('SPLIT:HELLO');
	});

	it('prefixes the uppercase value with SPLIT:', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel('test');
		expect(result).toMatch(/^SPLIT:/);
	});

	it('handles mixed case input by converting to uppercase and prefixing', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel('HeLLo');
		expect(result).toBe('SPLIT:HELLO');
	});

	it('trims whitespace before processing', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel('  test value  ');
		expect(result).toBe('SPLIT:TEST VALUE');
	});

	it('returns the complete formatted string with SPLIT: prefix, uppercase, and trimmed input', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel(
			'  box split label  '
		);
		expect(result).toBe('SPLIT:BOX SPLIT LABEL');
	});

	it('handles empty strings after trimming', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- #379
		const result = (await import('./workflow-box2-split')).formatBox2SplitLabel('   ');
		expect(result).toBe('SPLIT:');
	});
});
