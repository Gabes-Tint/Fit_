/**
 * `verify:changed` (issue #128, item 2): sizes a gate run to the diff instead
 * of guessing a tier. `verify-changed-plan.ts` is the pure decision function
 * this wires up to the real repository — git for the changed-file list, the
 * filesystem for sibling specs and route e2e files, and a grep over `src/**`
 * for specs that import a changed file — then runs the plan and writes
 * `reports/quality/gate-verify-changed.json` in the same shape every other
 * gate tier does.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { captureStatus } from '../security/shared';
import { gateLogDirectory, gateReportPath } from './gate-paths';
import { tiers } from './gates';
import { isServerSource, walk } from './mutation-scope';
import { isExcludedFromMutation } from './mutation-globs';
import { stepOutcome, summarizeOutcomes, summaryExitCode, type StepOutcome } from './run-outcome';
import { buildVerifyChangedPlan, type ChangedFile, type PlanStep } from './verify-changed-plan';
import { DOM_FREE_CLIENT_SPECS } from '../../quality/dom-free-client-specs.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportDirectory = path.join(projectRoot, 'reports', 'quality');
const label = 'verify-changed';

interface Options {
	base: string | undefined;
	allBrowsers: boolean;
	dryRun: boolean;
}

function parseArguments(argv: string[]): Options {
	let base: string | undefined;
	let allBrowsers = false;
	let dryRun = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--base') {
			base = argv[index + 1];
			if (base === undefined) throw new Error('--base requires a git ref.');
			index += 1;
		} else if (argument === '--all-browsers') allBrowsers = true;
		else if (argument === '--dry-run') dryRun = true;
		else throw new Error(`Unknown argument: ${argument ?? ''}`);
	}
	return { base, allBrowsers, dryRun };
}

function git(args: string[]): string {
	return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
}

/** `origin/main` by default (merge-base), or the ref `--base` names. */
function resolveBase(requested: string | undefined): string {
	const ref = requested ?? 'origin/main';
	return git(['merge-base', 'HEAD', ref]);
}

/** Committed changes since `base`, plus whatever is uncommitted or untracked right now. */
function changedFiles(base: string): ChangedFile[] {
	const committed = git(['diff', '--name-status', '-z', '--find-renames', base])
		.split('\0')
		.filter(Boolean);
	const changes: ChangedFile[] = [];
	for (let index = 0; index < committed.length;) {
		const status = committed[index++];
		const first = committed[index++];
		if (status === undefined || first === undefined) break;
		if (status.startsWith('R') || status.startsWith('C')) {
			const destination = committed[index++];
			if (destination !== undefined) changes.push({ status, path: destination });
		} else changes.push({ status, path: first });
	}
	const uncommitted = git(['diff', '--name-status', '-z', 'HEAD']).split('\0').filter(Boolean);
	for (let index = 0; index < uncommitted.length;) {
		const status = uncommitted[index++];
		const first = uncommitted[index++];
		if (status === undefined || first === undefined) break;
		changes.push({ status, path: first });
	}
	const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
		.split('\0')
		.filter(Boolean);
	const seen = new Set(changes.map((change) => change.path));
	for (const file of untracked) {
		if (!seen.has(file)) {
			changes.push({ status: '?', path: file });
			seen.add(file);
		}
	}
	return changes;
}

export function specCandidates(file: string): string[] {
	const withoutExtension = file.replace(/\.ts$/, '').replace(/\.svelte$/, '.svelte');
	const base = withoutExtension.replace(/\.svelte$/, '');
	const isSvelte = file.endsWith('.svelte');
	return isSvelte ? [`${base}.svelte.spec.ts`] : [`${base}.spec.ts`, `${base}.svelte.spec.ts`];
}

async function exists(file: string): Promise<boolean> {
	try {
		await readFile(path.join(projectRoot, file));
		return true;
	} catch {
		return false;
	}
}

/** Every `.ts`/`.svelte` source file under `src/`, for the import-path grep. */
export async function allSourceFiles(): Promise<string[]> {
	const files = await walk(path.join(projectRoot, 'src'));
	return files
		.map((file) => path.relative(projectRoot, file).split(path.sep).join('/'))
		.filter((file) => file.endsWith('.ts') || file.endsWith('.svelte'));
}

const SPEC_OR_E2E = /\.(?:spec|e2e)\.ts$/;

/**
 * A regex over an import specifier for a module whose basename is `base`:
 * requires a path-segment boundary (a quote or `/`) right before `base`, and
 * `base` immediately followed by an optional `.svelte` then the closing
 * quote — so `'$lib/components/WeekStrip'` and `'./WeekStrip.svelte'` both
 * match, while a longer name that merely contains `base` as a substring
 * (`WeekStripFoo`, `FooWeekStrip`) does not.
 */
function importPattern(base: string): RegExp {
	return new RegExp(`(?:['"]|/)${escapeRegExp(base)}(?:\\.svelte)?['"]`);
}

/**
 * Files (specs or plain modules) anywhere under `src/` whose source imports
 * the module path `file` resolves to — a plain string search over the
 * import specifier, not a type-checked resolution: cheap, and exact enough
 * for widening a spec list.
 */
async function filesImporting(file: string, allFiles: readonly string[]): Promise<string[]> {
	const withoutExtension = file.replace(/\.svelte$/, '').replace(/\.ts$/, '');
	const base = path.basename(withoutExtension);
	const pattern = importPattern(base);
	const matches: string[] = [];
	for (const candidate of allFiles) {
		if (candidate === file) continue;
		const source = await readFile(path.join(projectRoot, candidate), 'utf8');
		if (pattern.test(source)) matches.push(candidate);
	}
	return matches;
}

/**
 * Specs (`.spec.ts`/`.svelte.spec.ts`/`.e2e.ts`) that select for a changed
 * file: specs that import it directly, plus — one level of reverse imports
 * out (issue #154) — the sibling specs of any non-spec module that imports
 * it. That widening is what makes changing `WeekStrip.svelte` select
 * `TodayView.svelte.spec.ts`: `TodayView.svelte` imports `WeekStrip.svelte`,
 * not the other way around, and its spec never mentions `WeekStrip` at all.
 */
export async function importingSpecsOf(
	file: string,
	allFiles: readonly string[]
): Promise<string[]> {
	const importers = await filesImporting(file, allFiles);
	const matches: string[] = [];
	for (const importer of importers) {
		if (SPEC_OR_E2E.test(importer)) {
			matches.push(importer);
			continue;
		}
		for (const candidate of specCandidates(importer)) {
			if (await exists(candidate)) matches.push(candidate);
		}
	}
	return [...new Set(matches)];
}

function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function projectFor(spec: string): 'server' | 'client' {
	// `scripts/**` specs run under vitest's `server` project (vite.config.ts).
	return spec.startsWith('scripts/') || isServerSource(spec) ? 'server' : 'client';
}

/**
 * A log filename derived from a possibly diff-sized list of paths (a spec
 * group, an e2e file list, a mutation lane's changed files) must never embed
 * that list directly — a large diff can touch dozens of files and blow past
 * filesystem name limits (`ENAMETOOLONG`, issue #141). Name the log after the
 * step instead, plus a short stable hash of the list so repeat runs over the
 * same input land on the same filename.
 */
export function logFileName(step: string, items: readonly string[]): string {
	const hash = createHash('sha1').update(items.join('\n')).digest('hex').slice(0, 8);
	return `${step.replace(/[/:]/g, '-')}-${hash}`;
}

function vitestProjectArgs(project: 'server' | 'client', spec: string): string[] {
	if (project === 'server') return ['--project', 'server'];
	// A client spec is either DOM-free (client-node) or needs the real browser
	// (client); both project includes are passed and vitest matches the file
	// against whichever one actually includes it.
	return DOM_FREE_CLIENT_SPECS.includes(spec)
		? ['--project', 'client-node']
		: ['--project', 'client'];
}

async function runCommand(
	name: string,
	command: string,
	args: string[],
	logDirectory: string,
	extraEnv: NodeJS.ProcessEnv = {},
	logName: string = name
): Promise<{
	ok: boolean;
	outcome: StepOutcome;
	exitCode: number;
	durationMs: number;
	log: string;
}> {
	const logPath = path.join(logDirectory, `${logName.replace(/[/:]/g, '-')}.log`);
	const startedAt = Date.now();
	const { exitCode, output } = await captureStatus(command, args, {
		env: { ...process.env, ...extraEnv, FORCE_COLOR: '0' }
	});
	await writeFile(logPath, output);
	return {
		ok: exitCode === 0,
		outcome: stepOutcome(exitCode),
		exitCode,
		durationMs: Date.now() - startedAt,
		log: path.relative(projectRoot, logPath)
	};
}

function printPlan(steps: readonly PlanStep[], e2eProject: string): void {
	const labels: Record<PlanStep['category'], string> = {
		static: 'static',
		spec: 'specs',
		e2e: 'e2e',
		mutation: 'mutation',
		build: 'build'
	};
	if (steps.length === 0) {
		console.log('verify:changed: nothing to run beyond an empty diff.');
		return;
	}
	console.log(`verify:changed plan (e2e project: ${e2eProject}):`);
	for (const step of steps) {
		console.log(`  ${labels[step.category]}: ${step.name} (${step.reason})`);
	}
}

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	const base = resolveBase(options.base);
	const changed = changedFiles(base);
	const allFiles = await allSourceFiles();

	const siblingCache = new Map<string, string[]>();
	const importingCache = new Map<string, string[]>();
	const existsCache = new Map<string, boolean>();

	for (const file of changed) {
		if (!siblingCache.has(file.path)) {
			const candidates = specCandidates(file.path);
			const found: string[] = [];
			for (const candidate of candidates) if (await exists(candidate)) found.push(candidate);
			siblingCache.set(file.path, found);
		}
		if (!importingCache.has(file.path)) {
			importingCache.set(file.path, await importingSpecsOf(file.path, allFiles));
		}
	}

	// `exists` is synchronous per the plan's contract; resolve the async
	// filesystem checks it needs (route e2e candidates) up front.
	const routeCandidates = new Set<string>();
	for (const file of changed) {
		const parts = file.path.split('/');
		if (parts[0] === 'src' && parts[1] === 'routes' && parts.length > 2) {
			const name = parts[2];
			routeCandidates.add(`src/routes/${name}.e2e.ts`);
			routeCandidates.add(`src/routes/${name}/${name}.e2e.ts`);
		}
	}
	for (const candidate of routeCandidates) existsCache.set(candidate, await exists(candidate));

	const staticStepNames = tiers['verify:fast']
		.map((step) => step.name)
		.filter((name) => name !== 'test:unit:server');

	const resolvedPlan = buildVerifyChangedPlan({
		changed,
		staticSteps: staticStepNames,
		siblingSpecs: (file) => siblingCache.get(file) ?? [],
		importingSpecs: (file) => importingCache.get(file) ?? [],
		exists: (file) => existsCache.get(file) ?? false,
		projectFor,
		isMutated: (file) => !isExcludedFromMutation(file) && /^src\/lib\/.*\.ts$/.test(file),
		allBrowsers: options.allBrowsers
	});

	printPlan(resolvedPlan.steps, resolvedPlan.e2eProject);
	if (options.dryRun) return;

	const logDirectory = gateLogDirectory(reportDirectory, label);
	await rm(logDirectory, { recursive: true, force: true });
	await mkdir(logDirectory, { recursive: true });

	const startedAt = new Date();
	const started = Date.now();
	const results: {
		name: string;
		ok: boolean;
		outcome: StepOutcome;
		exitCode: number;
		durationMs: number;
		log: string;
		command: string;
	}[] = [];

	for (const step of resolvedPlan.steps) {
		if (step.category === 'static') {
			const run = await runCommand(step.name, 'bun', ['run', step.name], logDirectory);
			results.push({ name: step.name, command: `bun run ${step.name}`, ...run });
		}
	}
	const specSteps = resolvedPlan.steps.filter((step) => step.category === 'spec');
	if (specSteps.length > 0) {
		const grouped = new Map<string, string[]>();
		for (const step of specSteps) {
			const project = step.project ?? projectFor(step.name);
			const args = vitestProjectArgs(project, step.name);
			const key = args.join(' ');
			const files = grouped.get(key) ?? [];
			files.push(step.name);
			grouped.set(key, files);
		}
		for (const [projectArgsKey, files] of grouped) {
			const projectArgs = projectArgsKey.split(' ');
			const name = `spec: ${files.join(', ')}`;
			const run = await runCommand(
				name,
				'bunx',
				['vitest', 'run', ...projectArgs, ...files],
				logDirectory,
				{},
				logFileName('specs', files)
			);
			results.push({
				name,
				command: `bunx vitest run ${projectArgs.join(' ')} ${files.join(' ')}`,
				...run
			});
		}
	}
	const e2eSteps = resolvedPlan.steps.filter((step) => step.category === 'e2e');
	if (e2eSteps.length > 0) {
		const files = e2eSteps[0]?.name === 'full suite' ? [] : e2eSteps.map((step) => step.name);
		const args = ['playwright', 'test', ...files];
		const env: NodeJS.ProcessEnv =
			resolvedPlan.e2eProject === 'all'
				? { E2E_ALL_BROWSERS: '1' }
				: { E2E_PROJECT: 'mobile-chrome' };
		const name =
			e2eSteps[0]?.name === 'full suite' ? 'e2e: full suite' : `e2e: ${files.join(', ')}`;
		const run = await runCommand(name, 'bunx', args, logDirectory, env, logFileName('e2e', files));
		results.push({ name, command: `bunx ${args.join(' ')}`, ...run });
	}
	for (const step of resolvedPlan.steps) {
		if (step.category !== 'mutation') continue;
		const scriptName = `test:mutation:${step.name === 'security' ? 'security' : step.name === 'changed-client' ? 'changed:client' : 'changed:node'}`;
		const run = await runCommand(scriptName, 'bun', ['run', scriptName], logDirectory);
		results.push({ name: scriptName, command: `bun run ${scriptName}`, ...run });
	}
	for (const step of resolvedPlan.steps) {
		if (step.category !== 'build') continue;
		const run = await runCommand(step.name, 'bun', ['run', step.name], logDirectory);
		results.push({ name: step.name, command: `bun run ${step.name}`, ...run });
	}

	const summary = summarizeOutcomes(results);
	const report = {
		tier: 'verify:changed',
		base,
		ok: summary.ok,
		startedAt: startedAt.toISOString(),
		durationMs: Date.now() - started,
		stepsRun: results.length,
		stepsPlanned: results.length,
		failed: summary.failed,
		crashed: summary.crashed,
		plan: resolvedPlan.steps,
		steps: results
	};
	await writeFile(gateReportPath(reportDirectory, label), `${JSON.stringify(report, null, 2)}\n`);

	const notOk = results.filter((result) => !result.ok);
	for (const result of notOk) {
		console.error(
			`\n--- ${result.name} ${result.outcome === 'crashed' ? 'CRASHED' : 'failed'} (exit ${result.exitCode}) ---`
		);
		console.error(`See ${result.log}`);
	}
	console.log(
		`\nGate verify:changed: ${results.length - notOk.length}/${results.length} passed in ${((Date.now() - started) / 1000).toFixed(1)}s.`
	);
	if (!summary.ok) process.exitCode = summaryExitCode(summary);
}

if (import.meta.main) {
	await main();
}
