import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { laneOf } from './mutation-debt';
import { tiers } from './gates';
import { describeMutant, rankFilesBySurvivors, type StrykerReport } from './mutation-file-rank';
import { readJsonFileOrNull } from '../security/shared';

/**
 * The daily routine's starting point: the three worst files in the current
 * mutation debt, with their surviving mutants spelled out, so an agent has
 * something to act on without opening a Stryker HTML report by hand.
 *
 * Issue #87 decided every survivor is debt, so this always has a queue: the
 * full lane alone reported 143 undead mutants the day the routine was
 * designed. This script only ranks and formats what `mutation-run.ts` already
 * wrote to `reports/mutation/<lane>/mutation.json`; it never runs Stryker
 * itself.
 */

/** How many files the daily routine is asked to take per pass (QUALITY.md). */
export const WORST_FILES_PER_PASS = 3;

/**
 * One report per file, not one per lane.
 *
 * The full lane already covers every mutated file in the tree, so if it ran,
 * its report is the whole answer and the two changed lanes would only
 * double-count the same files. Only when the full lane did not run (or
 * crashed) do the changed lanes get merged instead, on the assumption their
 * scopes are disjoint by project (`server` vs `client`).
 */
export function combineReports(
	laneReports: Partial<Record<'changed-node' | 'changed-client' | 'full', StrykerReport | null>>
): StrykerReport {
	if (laneReports.full != null) return laneReports.full;
	const files: StrykerReport['files'] = {};
	for (const lane of ['changed-node', 'changed-client'] as const) {
		const report = laneReports[lane];
		if (report == null) continue;
		for (const [file, entry] of Object.entries(report.files)) {
			const existing = files[file];
			if (!existing) {
				files[file] = entry;
				continue;
			}
			const source = existing.source ?? entry.source;
			files[file] = {
				...(source === undefined ? {} : { source }),
				mutants: [...existing.mutants, ...entry.mutants]
			};
		}
	}
	return { files };
}

/** Markdown an agent can act on directly: worst files, each mutant named. */
export function formatDebtPlan(report: StrykerReport, worstCount = WORST_FILES_PER_PASS): string {
	const worst = rankFilesBySurvivors(report).slice(0, worstCount);
	if (worst.length === 0) {
		return '## Mutation debt plan\n\nNo surviving, uncovered or timed-out mutants in the latest report. Nothing to pay down.\n';
	}
	const sections = worst.map((file) => {
		const source = report.files[file.file]?.source;
		const mutants = file.mutants.map((mutant) => `- ${describeMutant(source, mutant)}`).join('\n');
		return `### \`${file.file}\` — ${String(file.survived)} survived, ${String(file.noCoverage)} uncovered, ${String(file.timeout)} timed out\n\n${mutants}`;
	});
	return `## Mutation debt plan\n\nThe ${String(worst.length)} worst file(s) in the current report, worst first. Kill the named mutant with a test that asserts real behavior; propose an equivalent-mutant call in the PR body rather than editing \`quality/mutation-equivalents.json\` directly.\n\n${sections.join('\n\n')}\n`;
}

async function readReport(file: string): Promise<StrykerReport | null> {
	return readJsonFileOrNull<StrykerReport>(file);
}

/**
 * Fetches the most recent successful scheduled audit's mutation evidence
 * instead of requiring a local Stryker run, for a machine that has not just
 * run `test:mutation:full` itself.
 */
function downloadFromCi(mutationRoot: string): void {
	const runId = execFileSync(
		'gh',
		[
			'run',
			'list',
			'--workflow',
			'mutation-audit.yml',
			'--status',
			'success',
			'--limit',
			'1',
			'--json',
			'databaseId',
			'--jq',
			'.[0].databaseId'
		],
		{ encoding: 'utf8' }
	).trim();
	if (runId === '') {
		throw new Error('No successful mutation-audit.yml run found to download from.');
	}
	const artifactName = execFileSync(
		'gh',
		['api', `repos/{owner}/{repo}/actions/runs/${runId}/artifacts`, '--jq', '.artifacts[0].name'],
		{ encoding: 'utf8' }
	).trim();
	if (artifactName === '') {
		throw new Error(`Run ${runId} has no mutation-evidence artifact to download.`);
	}
	execFileSync('gh', ['run', 'download', runId, '-n', artifactName, '-D', mutationRoot], {
		stdio: 'inherit'
	});
}

if (import.meta.main) {
	const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
	const mutationRoot = path.join(projectRoot, 'reports', 'mutation');
	if (process.argv.includes('--from-ci')) downloadFromCi(mutationRoot);

	const lanes = tiers.audit.map(laneOf) as ('changed-node' | 'changed-client' | 'full')[];
	const entries = await Promise.all(
		lanes.map(
			async (lane) =>
				[lane, await readReport(path.join(mutationRoot, lane, 'mutation.json'))] as const
		)
	);
	const combined = combineReports(Object.fromEntries(entries));
	const plan = formatDebtPlan(combined);

	await writeFile(path.join(mutationRoot, 'debt-plan.md'), plan);
	console.log(plan);
}
