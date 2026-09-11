import { describe, expect, it } from 'vitest';

describe('parseWorkflowProbe', () => {
	it('parses a name=value probe string into typed name and value properties', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('name=value')).toMatchObject({
			ok: true,
			name: 'name',
			value: 'value'
		});
	});

	it('trims whitespace from the name', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('  name  =value')).toMatchObject({
			ok: true,
			name: 'name',
			value: 'value'
		});
	});

	it('trims whitespace from the value', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('name=  value  ')).toMatchObject({
			ok: true,
			name: 'name',
			value: 'value'
		});
	});

	it('trims whitespace from both name and value', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('  name  =  value  ')).toMatchObject({
			ok: true,
			name: 'name',
			value: 'value'
		});
	});

	it('preserves additional = characters in the value', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('name=value=extra=chars')).toMatchObject({
			ok: true,
			name: 'name',
			value: 'value=extra=chars'
		});
	});

	it('rejects input with no = separator', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('namevalue')).toMatchObject({
			ok: false,
			reason: 'no-separator'
		});
	});

	it('rejects input with empty name', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('=value')).toMatchObject({
			ok: false,
			reason: 'empty-name'
		});
	});

	it('rejects input with whitespace-only name', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('   =value')).toMatchObject({
			ok: false,
			reason: 'empty-name'
		});
	});

	it('allows empty value', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('name=')).toMatchObject({
			ok: true,
			name: 'name',
			value: ''
		});
	});

	it('allows whitespace-only value (which gets trimmed to empty)', async () => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- https://github.com/Gabes-Tint/Fit_/issues/375
		const { parseWorkflowProbe } = await import('./workflow-probe');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- https://github.com/Gabes-Tint/Fit_/issues/375
		expect(parseWorkflowProbe('name=   ')).toMatchObject({
			ok: true,
			name: 'name',
			value: ''
		});
	});
});
