import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';
import { readJsonFile } from '../security/shared';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = path.join(projectRoot, 'reports', 'quality', 'suppressions.json');
const baselinePath = path.join(projectRoot, 'quality', 'suppression-baseline.json');
const scannedExtensions = new Set([
	'.ts',
	'.js',
	'.mjs',
	'.cjs',
	'.svelte',
	'.css',
	'.html',
	'.json',
	'.yml',
	'.yaml'
]);

interface Baseline {
	maxUnjustified: number;
}

interface Occurrence {
	file: string;
	line: number;
	kind: string;
	justified: boolean;
	reference: string | null;
	text: string;
}

// The literals are split so this scanner never matches its own source;
// a path exclusion would leave an unwatched place to hide suppressions.
const patterns: { kind: string; pattern: RegExp }[] = [
	{ kind: 'eslint', pattern: new RegExp(`eslint-${'disable'}`) },
	{ kind: 'typescript', pattern: new RegExp(`@ts-${'(?:ignore|expect-error|nocheck)'}`) },
	{ kind: 'prettier', pattern: new RegExp(`prettier-${'ignore'}`) },
	{ kind: 'cspell', pattern: new RegExp(`cspell:${'(?:disable|ignore)'}`, 'i') },
	{ kind: 'coverage', pattern: new RegExp(`(?:istanbul|c8|v8) ${'ignore'}`) },
	{ kind: 'stryker', pattern: new RegExp(`Stryker ${'disable'}`) },
	{ kind: 'semgrep', pattern: new RegExp(`no${'semgrep'}`) },
	{ kind: 'gitleaks', pattern: new RegExp(`gitleaks:${'allow'}`) },
	{ kind: 'markdownlint', pattern: new RegExp(`markdownlint-${'disable'}`) },
	{ kind: 'trivy', pattern: new RegExp(`trivy:${'ignore'}`) },
	{ kind: 'knip', pattern: new RegExp(`knip-${'ignore'}`) }
];

/** A justification is an issue key (ABC-123) or a URL, on the line or the one above it. */
const referencePattern = /\b[A-Z][A-Z0-9]{1,9}-\d+\b|https?:\/\/\S+/;

function findReference(line: string, previous: string | undefined): string | null {
	return (
		(referencePattern.exec(line) ?? (previous ? referencePattern.exec(previous) : null))?.[0] ??
		null
	);
}

const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: projectRoot });
const files = stdout
	.split('\0')
	.filter((file) => file !== '' && scannedExtensions.has(path.extname(file)));

const occurrences: Occurrence[] = [];
for (const file of files) {
	const lines = (await readFile(path.join(projectRoot, file), 'utf8')).split('\n');
	lines.forEach((line, index) => {
		for (const { kind, pattern } of patterns) {
			if (!pattern.test(line)) continue;
			const reference = findReference(line, index > 0 ? lines[index - 1] : undefined);
			occurrences.push({
				file,
				line: index + 1,
				kind,
				justified: reference !== null,
				reference,
				text: line.trim().slice(0, 200)
			});
		}
	});
}

const unjustified = occurrences.filter((occurrence) => !occurrence.justified);
const baseline = await readJsonFile<Baseline>(baselinePath);

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(
	reportPath,
	`${JSON.stringify({ baseline, occurrences, total: occurrences.length, unjustified: unjustified.length }, null, 2)}\n`
);

if (process.argv.includes('--update')) {
	await writeFile(
		baselinePath,
		`${JSON.stringify({ maxUnjustified: unjustified.length }, null, 2)}\n`
	);
	console.log(`Suppression baseline updated to ${unjustified.length}.`);
	process.exit(0);
}

console.log(
	`Suppressions: ${occurrences.length} total, ${unjustified.length} unjustified, baseline ${baseline.maxUnjustified}.`
);

if (unjustified.length > baseline.maxUnjustified) {
	for (const occurrence of unjustified) {
		console.error(
			`  ${occurrence.file}:${occurrence.line}  ${occurrence.kind}  ${occurrence.text}`
		);
	}
	console.error(
		`\nUnjustified suppressions rose from ${baseline.maxUnjustified} to ${unjustified.length}.`
	);
	console.error(
		'Add an issue key or URL on the suppression line or the line above it, or remove the suppression.'
	);
	console.error(
		'Raising the baseline requires a deliberate review: bun run check:suppressions -- --update.'
	);
	process.exitCode = 1;
} else if (unjustified.length < baseline.maxUnjustified) {
	console.log(
		`Ratchet can be tightened: lower maxUnjustified to ${unjustified.length} in quality/suppression-baseline.json.`
	);
}
