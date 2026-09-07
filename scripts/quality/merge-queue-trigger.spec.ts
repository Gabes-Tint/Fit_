import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	declaresRequiredCheck,
	mergeQueueFailures,
	mergeQueueTrigger,
	requiredCheckName,
	workflowTriggers
} from './merge-queue-trigger';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const ciWorkflowPath = path.join('.github', 'workflows', 'ci.yml');
const ciWorkflow = await readFile(path.join(projectRoot, ciWorkflowPath), 'utf8');

describe('workflowTriggers', () => {
	it('reads the block form, ignoring nested keys and comments', () => {
		expect(
			workflowTriggers(
				[
					'name: CI',
					'on:',
					'  push:',
					'    branches: [main]',
					'  # a comment',
					'  merge_group:',
					'',
					'jobs:',
					'  build:'
				].join('\n')
			)
		).toEqual(['push', 'merge_group']);
	});

	it('reads the inline sequence form', () => {
		expect(workflowTriggers('on: [push, merge_group]\n')).toEqual(['push', 'merge_group']);
	});

	it('is empty for a workflow with no on: mapping', () => {
		expect(workflowTriggers('name: CI\njobs:\n  build:\n')).toEqual([]);
	});
});

describe('declaresRequiredCheck', () => {
	it('finds the job whose name is the required check', () => {
		expect(declaresRequiredCheck(ciWorkflow)).toBe(true);
	});

	it('does not match the name at another indentation', () => {
		expect(declaresRequiredCheck(`name: ${requiredCheckName}\n`)).toBe(false);
	});
});

describe('mergeQueueFailures', () => {
	it('accepts the workflow as it stands', () => {
		expect(mergeQueueFailures(ciWorkflow, ciWorkflowPath)).toEqual([]);
	});

	it('rejects the workflow once the merge_group trigger is removed', () => {
		const withoutTrigger = ciWorkflow.replace(`  ${mergeQueueTrigger}:\n`, '');
		expect(withoutTrigger).not.toBe(ciWorkflow);
		const failures = mergeQueueFailures(withoutTrigger, ciWorkflowPath);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain(`no \`${mergeQueueTrigger}:\` trigger`);
	});

	it('rejects a workflow that no longer reports the required check at all', () => {
		const failures = mergeQueueFailures(
			ciWorkflow.replace(`    name: ${requiredCheckName}\n`, '    name: Something else\n'),
			ciWorkflowPath
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('no longer declares the required check');
	});
});
