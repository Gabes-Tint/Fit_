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
// render it for humans here. eslint.config.js's projectService gives each
// worker its own full TypeScript program (~1.1 GB) — separate processes
// can't share it, so peak memory grows with worker count, though not quite
// linearly (measured via cgroup accounting on a 32-core box: 8 workers
// ~8.9 GB, 4 workers ~5.4-5.7 GB — not half, since some memory is shared
// fixed overhead). Concurrency is half the host's cores, capped at four to
// bound memory, floored at one.
const concurrency = Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2)));

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
