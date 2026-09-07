import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { readJsonFile } from '../security/shared';
import type { Thresholds } from './config-types';

/**
 * The percentage threshold weakens as the tree grows, so this adds an absolute
 * clone ratchet on top. Reads the report written by the preceding jscpd run.
 */

interface JscpdReport {
	statistics?: { total?: { clones?: number; duplicatedLines?: number } };
}

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = path.join(projectRoot, 'reports', 'quality', 'duplication', 'jscpd-report.json');
const { duplication } = await readJsonFile<Thresholds>(
	path.join(projectRoot, 'quality', 'thresholds.json')
);

let report: JscpdReport;
try {
	report = await readJsonFile<JscpdReport>(reportPath);
} catch {
	throw new Error(
		`jscpd did not write a parsable report at ${path.relative(projectRoot, reportPath)}.`
	);
}

const clones = report.statistics?.total?.clones ?? 0;
const duplicatedLines = report.statistics?.total?.duplicatedLines ?? 0;

console.log(
	`Duplication: ${clones} clones, ${duplicatedLines} duplicated lines, ratchet ${duplication.maxClones}.`
);

if (clones > duplication.maxClones) {
	console.error(
		`\n${clones} clones exceed the ratchet of ${duplication.maxClones}. See ${path.relative(projectRoot, reportPath)}.`
	);
	console.error('Extract the shared logic, or record a new ratchet as a reviewed change.');
	process.exitCode = 1;
}
