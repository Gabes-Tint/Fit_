import { appendFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import type { GateStep } from './gates';
import { tiers } from './gates';
import {
	describeMutant,
	isDebtStatus,
	rankFilesBySurvivors,
	type StrykerReport
} from './mutation-file-rank';
import { readJsonFileOrNull } from '../security/shared';

/**
 * The reporting half of the scheduled mutation audit.
 *
 * Those lanes no longer fail a build -- Gabriel's decision on 2026-09-04 was to
 * pay mutation debt daily rather than block on it -- so a non-zero exit from a
 * lane now goes nowhere on its own. This reads what each lane wrote and turns
 * it into one Markdown report naming the mutants that were not killed, so the
 * debt reaches a person through a GitHub issue instead of dying with the exit
 * code. A lane that swallowed its failure and printed nothing would be worth
 * less than not running it.
 *
 * It always exits 0: it reports debt, it is not a gate.
 *
 * **Old rule (through 2026-09-04):** a lane counted as debt only when its own
 * verdict failed -- the full lane's aggregate score below 80%, a changed lane
 * below its strict floor. Issue #87 found that gave the full lane nothing to
 * report: 96.68% clears 80% easily no matter how many of its 143 survivors,
 * uncovered and timed-out mutants sit underneath it, so the daily debt queue
 * this system exists to feed was permanently empty.
 *
 * **New rule (2026-09-05, issue #87, option 1):** every survivor is debt,
 * regardless of aggregate score. A lane with one uncovered mutant is not
 * "clean" merely because its score still clears the bar.
 */

/** GitHub rejects an issue body over 65536 bytes, so the list is capped. */
export const MAX_SURVIVORS_PER_LANE = 25;

/** How many worst files get full mutant-by-mutant descriptions per lane. */
export const WORST_FILES_PER_LANE = 3;

interface Verdict {
	ok: boolean;
	killedScore: number;
	mutationScore: number;
	survived: number;
	timeout: number;
	noCoverage: number;
	failures: string[];
}

interface Crash {
	missingArtifact: string;
	strykerExitCode: number;
	error: string;
}

export interface DebtReport {
	/** True when any lane owes work or died without a verdict. */
	debt: boolean;
	/** True when at least one lane crashed rather than reaching a verdict. */
	crashed: boolean;
	/** Survived + NoCoverage + Timeout, summed across every lane that ran. */
	survivorCount: number;
	/** Markdown, used verbatim as the issue body and the job summary. */
	body: string;
	/** One `::warning::` line per lane with something to say. */
	warnings: string[];
}

/**
 * The lane directory, read off the step's own declared artifact rather than
 * mapped from its script name: `gates.ts` already states it once, and a second
 * spelling here is a second thing to keep in step.
 */
export function laneOf(step: GateStep): string {
	const lane = (step.artifacts?.[0] ?? '').split('/')[2];
	if (lane === undefined || lane === '') {
		throw new Error(`No lane directory declared for ${step.name}.`);
	}
	return lane;
}

export function survivorLines(report: StrykerReport | null): string[] {
	if (report === null) return [];
	const lines: string[] = [];
	for (const [file, entry] of Object.entries(report.files)) {
		for (const mutant of entry.mutants) {
			if (!isDebtStatus(mutant.status)) continue;
			const replacement = mutant.replacement.replace(/\s+/g, ' ').slice(0, 80);
			lines.push(
				`- \`${file}:${String(mutant.location.start.line)}\` — ${mutant.status}, ${mutant.mutatorName} → \`${replacement}\``
			);
		}
	}
	return lines.sort();
}

/**
 * Every file with a surviving mutant, worst first, and full mutant
 * descriptions for the worst `WORST_FILES_PER_LANE` of them -- the shape
 * issue #87 asked for so a daily agent has somewhere to start without opening
 * the raw Stryker report.
 */
function fileBreakdown(report: StrykerReport | null): string {
	const files = rankFilesBySurvivors(report);
	if (files.length === 0) return '';
	const list = files
		.map(
			(file) =>
				`- \`${file.file}\` — ${String(file.survived)} survived, ${String(file.noCoverage)} uncovered, ${String(file.timeout)} timed out`
		)
		.join('\n');
	const worst = files.slice(0, WORST_FILES_PER_LANE);
	const details = worst
		.map((file) => {
			const source = report?.files[file.file]?.source;
			const mutants = file.mutants
				.map((mutant) => `  - ${describeMutant(source, mutant)}`)
				.join('\n');
			return `**\`${file.file}\`**\n\n${mutants}`;
		})
		.join('\n\n');
	return `\n\n**Files with survivors, worst first:**\n\n${list}\n\n<details><summary>Mutant descriptions for the ${String(worst.length)} worst file(s)</summary>\n\n${details}\n\n</details>`;
}

/** Injected so the report can be tested without a mutation run. */
export type JsonReader = (file: string) => Promise<unknown>;

const RULE_NOTE =
	"**Old rule:** a lane counted as debt only when its own verdict failed (the full lane's " +
	'aggregate score below 80%, a changed lane below its strict floor). **New rule (2026-09-05, ' +
	'#87):** every survivor is debt, regardless of aggregate score -- a lane that still clears its ' +
	'threshold but leaves mutants Survived, NoCoverage or Timeout still owes that work.';

export async function collectMutationDebt(
	mutationRoot: string,
	lanes: string[],
	readJson: JsonReader
): Promise<DebtReport> {
	const sections: string[] = [];
	const warnings: string[] = [];
	let debt = false;
	let crashed = false;
	let survivorCount = 0;

	for (const lane of lanes) {
		const directory = path.join(mutationRoot, lane);
		const crash = (await readJson(path.join(directory, 'crash.json'))) as Crash | null;
		if (crash !== null) {
			debt = true;
			crashed = true;
			sections.push(
				`### \`${lane}\` — crashed, no verdict\n\nThe lane died before measuring anything, so it says nothing about the tree either way. Missing artifact: \`${crash.missingArtifact}\`. Stryker exit ${String(crash.strykerExitCode)}.\n\n\`\`\`\n${crash.error}\n\`\`\``
			);
			warnings.push(`${lane} crashed without a verdict: ${crash.error}`);
			continue;
		}

		const verdict = (await readJson(path.join(directory, 'verdict.json'))) as Verdict | null;
		if (verdict === null) {
			sections.push(
				`### \`${lane}\` — not run\n\nNo verdict and no crash record; the lane was skipped.`
			);
			continue;
		}

		const laneSurvivors = verdict.survived + verdict.noCoverage + verdict.timeout;
		if (verdict.ok && laneSurvivors === 0) {
			sections.push(
				`### \`${lane}\` — clean\n\nKilled score ${verdict.killedScore.toFixed(2)}%, Stryker-compatible score ${verdict.mutationScore.toFixed(2)}%.`
			);
			continue;
		}

		debt = true;
		survivorCount += laneSurvivors;
		const strykerReport = (await readJson(
			path.join(directory, 'mutation.json')
		)) as StrykerReport | null;
		const survivors = survivorLines(strykerReport);
		const shown = survivors.slice(0, MAX_SURVIVORS_PER_LANE);
		const elided =
			survivors.length > shown.length
				? `\n\n…and ${String(survivors.length - shown.length)} more, in the run artifacts.`
				: '';
		const scoreNote = verdict.ok
			? `Passes its own threshold (killed score ${verdict.killedScore.toFixed(2)}%, Stryker-compatible score ${verdict.mutationScore.toFixed(2)}%), but every survivor is still owed.`
			: `Killed score ${verdict.killedScore.toFixed(2)}%, Stryker-compatible score ${verdict.mutationScore.toFixed(2)}%.\n\n${verdict.failures.map((failure) => `- ${failure}`).join('\n')}`;
		sections.push(
			`### \`${lane}\` — ${String(verdict.survived)} survived, ${String(verdict.noCoverage)} uncovered, ${String(verdict.timeout)} timed out\n\n${scoreNote}${fileBreakdown(strykerReport)}\n\n<details><summary>Mutants that were not killed (${String(survivors.length)})</summary>\n\n${shown.join('\n')}${elided}\n\n</details>`
		);
		warnings.push(
			verdict.ok
				? `${lane} reported ${String(laneSurvivors)} surviving mutant(s) despite passing its own threshold`
				: `${lane} reported mutation debt: ${verdict.failures.join('; ')}`
		);
	}

	const heading = debt
		? '## Scheduled mutation audit: debt to pay\n\nThese lanes report, they do not gate. Nothing is blocked; the work below is owed.'
		: '## Scheduled mutation audit: clean\n\nEvery scheduled lane reached its verdict with nothing owed.';
	return {
		debt,
		crashed,
		survivorCount,
		body: `${heading}\n\n${RULE_NOTE}\n\n${sections.join('\n\n')}\n`,
		warnings
	};
}

if (import.meta.main) {
	const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
	const mutationRoot = path.join(projectRoot, 'reports', 'mutation');
	const readJson: JsonReader = (file) => readJsonFileOrNull<unknown>(file);
	const report = await collectMutationDebt(mutationRoot, tiers.audit.map(laneOf), readJson);

	await writeFile(path.join(mutationRoot, 'debt.md'), report.body);
	for (const warning of report.warnings) console.log(`::warning::${warning}`);
	console.log(report.body);

	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary !== undefined && summary !== '') await appendFile(summary, report.body);
	const output = process.env.GITHUB_OUTPUT;
	if (output !== undefined && output !== '') {
		await appendFile(
			output,
			`debt=${String(report.debt)}\ncrashed=${String(report.crashed)}\nsurvivors=${String(report.survivorCount)}\n`
		);
	}
}
