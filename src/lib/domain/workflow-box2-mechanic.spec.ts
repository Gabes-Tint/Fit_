import { describe, expect, it } from 'vitest';

describe('formatBox2MechanicProbe', () => {
	it('trims whitespace and converts to uppercase with BOX2: prefix', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/377
		const mod = await import('./workflow-box2-mechanic');
		const { formatBox2MechanicProbe } = mod as {
			formatBox2MechanicProbe: (value: string) => string;
		};
		expect(formatBox2MechanicProbe(' ready ')).toBe('BOX2:READY');
	});

	it('converts mixed case input to uppercase with BOX2: prefix', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/377
		const mod = await import('./workflow-box2-mechanic');
		const { formatBox2MechanicProbe } = mod as {
			formatBox2MechanicProbe: (value: string) => string;
		};
		expect(formatBox2MechanicProbe('mixed Case')).toBe('BOX2:MIXED CASE');
	});

	it('is framework-free with no side effects', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/377
		const mod = await import('./workflow-box2-mechanic');
		const { formatBox2MechanicProbe } = mod as {
			formatBox2MechanicProbe: (value: string) => string;
		};
		const input = 'test input';
		const result1 = formatBox2MechanicProbe(input);
		const result2 = formatBox2MechanicProbe(input);
		expect(result1).toBe(result2);
		expect(result1).toBe('BOX2:TEST INPUT');
	});

	it('preserves internal spaces when trimming', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/377
		const mod = await import('./workflow-box2-mechanic');
		const { formatBox2MechanicProbe } = mod as {
			formatBox2MechanicProbe: (value: string) => string;
		};
		expect(formatBox2MechanicProbe('  hello  world  ')).toBe('BOX2:HELLO  WORLD');
	});
});
