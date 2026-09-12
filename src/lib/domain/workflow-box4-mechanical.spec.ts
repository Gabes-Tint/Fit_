import { describe, expect, it } from 'vitest';

interface WorkflowBox4Mechanical {
	BOX4_PROBE_LABEL: string;
}

describe('workflow-box4-mechanical', () => {
	it('exports BOX4_PROBE_LABEL as "box4-mechanical-probe"', async () => {
		const module = (await import('./workflow-box4-mechanical')) as WorkflowBox4Mechanical;
		expect(module.BOX4_PROBE_LABEL).toBe('box4-mechanical-probe');
	});
});
