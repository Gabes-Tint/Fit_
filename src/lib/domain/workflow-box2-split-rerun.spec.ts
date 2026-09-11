import { describe, it, expect } from 'vitest';

type FormatSplitProbeModule = {
	formatSplitProbe: (value: string) => string;
};

describe('formatSplitProbe', () => {
	it('should trim whitespace, convert to uppercase, and prefix with RERUN:', async () => {
		const { formatSplitProbe } =
			(await import('$lib/domain/workflow-box2-split-rerun')) as FormatSplitProbeModule;
		expect(formatSplitProbe('  hello world  ')).toBe('RERUN:HELLO WORLD');
	});

	it('should handle normal text without leading/trailing spaces', async () => {
		const { formatSplitProbe } =
			(await import('$lib/domain/workflow-box2-split-rerun')) as FormatSplitProbeModule;
		expect(formatSplitProbe('probe')).toBe('RERUN:PROBE');
	});

	it('should handle empty string', async () => {
		const { formatSplitProbe } =
			(await import('$lib/domain/workflow-box2-split-rerun')) as FormatSplitProbeModule;
		expect(formatSplitProbe('')).toBe('RERUN:');
	});

	it('should handle whitespace-only input', async () => {
		const { formatSplitProbe } =
			(await import('$lib/domain/workflow-box2-split-rerun')) as FormatSplitProbeModule;
		expect(formatSplitProbe('   ')).toBe('RERUN:');
	});
});
