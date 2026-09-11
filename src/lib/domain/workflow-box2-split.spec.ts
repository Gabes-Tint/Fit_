import { describe, expect, it } from 'vitest';

describe('formatBox2SplitLabel', () => {
	it('exports formatBox2SplitLabel from the module', async () => {
		expect(
			((await import('./workflow-box2-split')) as Record<string, unknown>).formatBox2SplitLabel
		).toBeDefined();
	});

	it('trims the input value', async () => {
		const result = (
			(await import('./workflow-box2-split')) as Record<string, (value: string) => string>
		).formatBox2SplitLabel('  test  ');
		expect(result).toMatch(/^SPLIT:/);
	});

	it('converts the trimmed value to uppercase', async () => {
		const result = (
			(await import('./workflow-box2-split')) as Record<string, (value: string) => string>
		).formatBox2SplitLabel('hello');
		expect(result).toBe('SPLIT:HELLO');
	});

	it('prefixes the uppercase value with SPLIT:', async () => {
		const result = (
			(await import('./workflow-box2-split')) as Record<string, (value: string) => string>
		).formatBox2SplitLabel('test');
		expect(result).toMatch(/^SPLIT:/);
	});

	it('handles mixed case input by converting to uppercase and prefixing', async () => {
		const result = (
			(await import('./workflow-box2-split')) as Record<string, (value: string) => string>
		).formatBox2SplitLabel('HeLLo');
		expect(result).toBe('SPLIT:HELLO');
	});

	it('trims whitespace before processing', async () => {
		const result = (
			(await import('./workflow-box2-split')) as Record<string, (value: string) => string>
		).formatBox2SplitLabel('  test value  ');
		expect(result).toBe('SPLIT:TEST VALUE');
	});

	it('returns the complete formatted string with SPLIT: prefix, uppercase, and trimmed input', async () => {
		const result = (
			(await import('./workflow-box2-split')) as Record<string, (value: string) => string>
		).formatBox2SplitLabel('  box split label  ');
		expect(result).toBe('SPLIT:BOX SPLIT LABEL');
	});

	it('handles empty strings after trimming', async () => {
		const result = (
			(await import('./workflow-box2-split')) as Record<string, (value: string) => string>
		).formatBox2SplitLabel('   ');
		expect(result).toBe('SPLIT:');
	});
});
