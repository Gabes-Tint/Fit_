import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	describeMutationCrash,
	formatMutationCrash,
	recordMutationCrash,
	type MutationCrash
} from './mutation-crash';
import { CRASH_EXIT_CODE } from './run-outcome';
import { readJsonFile } from '../security/shared';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'fit-mutation-crash-'));
	roots.push(root);
	return root;
}

describe('mutation crash description', () => {
	it('names the report the run never wrote and the error that stopped it', async () => {
		const root = await workspace();
		const crash = await describeMutationCrash({
			projectRoot: root,
			lane: 'security',
			reportPath: path.join(root, 'reports', 'mutation', 'security', 'mutation.json'),
			strykerExitCode: 1,
			error: new Error('ENOENT: no such file or directory')
		});
		expect(crash.reportWritten).toBe(false);
		expect(crash.missingArtifact).toBe('reports/mutation/security/mutation.json');
		expect(crash.error).toBe('ENOENT: no such file or directory');
		expect(crash.strykerExitCode).toBe(1);
		expect(crash.verdict).toBe('crashed');
	});

	it('exits with the crash status rather than the status a surviving mutant uses', async () => {
		const root = await workspace();
		const crash = await describeMutationCrash({
			projectRoot: root,
			lane: 'changed-client',
			reportPath: path.join(root, 'mutation.json'),
			strykerExitCode: 1,
			error: 'Failed to initialize projects'
		});
		expect(crash.exitCode).toBe(CRASH_EXIT_CODE);
		expect(crash.exitCode).not.toBe(1);
	});

	it('distinguishes a report that exists but could not be judged', async () => {
		const root = await workspace();
		const reportPath = path.join(root, 'mutation.json');
		await writeFile(reportPath, 'not json\n');
		const crash = await describeMutationCrash({
			projectRoot: root,
			lane: 'full',
			reportPath,
			strykerExitCode: 0,
			error: new Error('Mutation report is stale.')
		});
		expect(crash.reportWritten).toBe(true);
		expect(formatMutationCrash(crash, 'crash.json')).toContain('unusable artifact');
	});
});

describe('mutation crash message', () => {
	const crash: MutationCrash = {
		lane: 'security',
		verdict: 'crashed',
		missingArtifact: 'reports/mutation/security/mutation.json',
		reportWritten: false,
		strykerExitCode: 1,
		error: 'Failed to initialize projects',
		exitCode: CRASH_EXIT_CODE,
		crashedAt: '2026-09-04T00:00:00.000Z'
	};

	it('says the run crashed and names the artifact and the error', () => {
		const message = formatMutationCrash(crash, 'reports/mutation/security/crash.json');
		expect(message).toContain('mutation lane CRASHED: it produced no verdict');
		expect(message).toContain('reports/mutation/security/mutation.json');
		expect(message).toContain('Failed to initialize projects');
		expect(message).toContain('reports/mutation/security/crash.json');
	});

	it('never implies mutation debt, which is what cost the half hour', () => {
		const message = formatMutationCrash(crash, 'crash.json');
		expect(message).toContain('This is not mutation debt.');
		expect(message).not.toMatch(/score is below|survived a change|killed-only/);
	});

	it('records the crash where a verdict would sit, in machine-readable form', async () => {
		const root = await workspace();
		const crashPath = path.join(root, 'crash.json');
		await recordMutationCrash(crashPath, crash);
		const stored = await readJsonFile<MutationCrash>(crashPath);
		expect(stored).toStrictEqual(crash);
	});
});
