import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { captureStatus, readJsonFile } from '../security/shared';

interface LintMessage {
	ruleId: string | null;
	severity: number;
	message: string;
	line: number;
	column: number;
}

interface LintResult {
	filePath: string;
	messages: LintMessage[];
	errorCount: number;
	warningCount: number;
}

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = path.join(projectRoot, 'reports', 'quality', 'eslint.json');
await mkdir(path.dirname(reportPath), { recursive: true });

// ESLint takes one formatter per run, so emit the machine-readable one and
// render it for humans here. Type-aware lint is the tier's critical path; past
// the measured turnover point extra workers cost more than they save, so
// concurrency is half the host's cores, capped at eight, floored at one.
const concurrency = Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2)));

const { exitCode } = await captureStatus(
	path.join(projectRoot, 'node_modules', '.bin', 'eslint'),
	[
		'.',
		'--max-warnings',
		'0',
		'--concurrency',
		String(concurrency),
		'--format',
		'json',
		'--output-file',
		reportPath
	],
	{ stream: true }
);

let results: LintResult[];
try {
	results = await readJsonFile<LintResult[]>(reportPath);
} catch {
	// A configuration error (exit 2) leaves no parsable report behind.
	process.exitCode = exitCode === 0 ? 1 : exitCode;
	throw new Error(`ESLint exited with code ${exitCode} without writing a report.`);
}

const problems = results.filter((result) => result.errorCount + result.warningCount > 0);
for (const result of problems) {
	console.log(path.relative(projectRoot, result.filePath));
	for (const message of result.messages) {
		const level = message.severity === 2 ? 'error' : 'warning';
		console.log(
			`  ${message.line}:${message.column}  ${level}  ${message.message}  ${message.ruleId ?? ''}`
		);
	}
}

const errors = results.reduce((total, result) => total + result.errorCount, 0);
const warnings = results.reduce((total, result) => total + result.warningCount, 0);
console.log(
	`ESLint: ${errors} errors, ${warnings} warnings across ${results.length} files. Report: ${path.relative(projectRoot, reportPath)}`
);

if (exitCode !== 0) process.exitCode = exitCode;
