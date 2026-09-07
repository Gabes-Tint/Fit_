import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { GateStep } from './gates';
import { ciJobs, isCiJobName, isTierName, tiers } from './gates';
import { gateLogDirectory, gateReportPath } from './gate-paths';
import { pooled } from './pool';
import { summarizeOutcomes, summaryExitCode, type StepOutcome } from './run-outcome';
import { runLoggedStep } from './step-runner';
import { captureStatus } from '../security/shared';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportDirectory = path.join(projectRoot, 'reports', 'quality');
const failureLogLines = 60;

interface StepResult {
	name: string;
	purpose: string;
	command: string;
	ok: boolean;
	/**
	 * `failed` is a verdict against the change; `crashed` means the step never
	 * reached one, so it proves nothing in either direction.
	 */
	outcome: StepOutcome;
	exitCode: number;
	durationMs: number;
	log: string;
	artifacts: string[];
}

interface Options {
	tier: string;
	bail: boolean;
	stream: boolean;
	only: string[];
	job: string | null;
}

function parseArguments(argv: string[]): Options {
	const [tier, ...rest] = argv;
	const only: string[] = [];
	let bail = false;
	let stream = false;
	let job: string | null = null;

	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index];
		if (argument === '--bail') bail = true;
		else if (argument === '--stream') stream = true;
		else if (argument === '--only') {
			const value = rest[index + 1];
			if (value === undefined) throw new Error('--only requires a comma-separated step list.');
			only.push(...value.split(',').filter(Boolean));
			index += 1;
		} else if (argument === '--job') {
			const value = rest[index + 1];
			if (value === undefined) throw new Error('--job requires a CI job name.');
			job = value;
			index += 1;
		} else throw new Error(`Unknown argument: ${argument ?? ''}`);
	}

	if (tier === undefined) throw new Error(`Usage: gate.ts <${Object.keys(tiers).join('|')}>`);
	return { tier, bail, stream, only, job };
}

function formatDuration(milliseconds: number): string {
	return milliseconds < 1000
		? `${milliseconds}ms`
		: `${(milliseconds / 1000).toFixed(1)}s`.padStart(6, ' ');
}

interface StepRun {
	result: StepResult;
	output: string;
}

async function runStep(
	step: GateStep,
	stream: boolean,
	logDirectory: string,
	signal: AbortSignal
): Promise<StepRun> {
	const run = await runLoggedStep(step.name, 'bun', ['run', step.name], logDirectory, {
		stream,
		signal
	});

	return {
		output: run.output,
		result: {
			name: step.name,
			purpose: step.purpose,
			command: `bun run ${step.name}`,
			ok: run.ok,
			outcome: run.outcome,
			exitCode: run.exitCode,
			durationMs: run.durationMs,
			log: run.log,
			artifacts: step.artifacts ?? []
		}
	};
}

/**
 * A step is not one process — `lint` alone peaks near 5 GB — so width stays
 * well under the core count. `--stream` forces one at a time to keep child
 * output readable.
 */
function poolWidth(stream: boolean): number {
	if (stream) return 1;
	return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4)));
}

/**
 * `check` syncs `.svelte-kit/` while concurrent steps read its generated
 * types; syncing once up front removes the race, and the step's own sync then
 * no-ops.
 */
async function syncGeneratedTypes(): Promise<void> {
	const { exitCode } = await captureStatus(
		path.join(projectRoot, 'node_modules', '.bin', 'svelte-kit'),
		['sync'],
		{ env: { ...process.env, FORCE_COLOR: '0' } }
	);
	if (exitCode !== 0) throw new Error(`svelte-kit sync failed with exit code ${exitCode}.`);
}

function printFailure(result: StepResult, output: string): void {
	const lines = output.split('\n');
	const tail = lines.length > failureLogLines ? lines.slice(-failureLogLines) : lines;
	const headline =
		result.outcome === 'crashed'
			? `${result.name} CRASHED without a verdict (exit ${result.exitCode}) — not a finding`
			: `${result.name} failed (exit ${result.exitCode})`;
	console.error(`\n--- ${headline} ---`);
	if (lines.length > tail.length) {
		console.error(`[${lines.length - tail.length} earlier lines in ${result.log}]`);
	}
	console.error(tail.join('\n').trimEnd());
}

const options = parseArguments(process.argv.slice(2));
if (!isTierName(options.tier)) {
	throw new Error(`Unknown tier "${options.tier}". Known tiers: ${Object.keys(tiers).join(', ')}.`);
}

if (options.job !== null && !isCiJobName(options.job)) {
	throw new Error(
		`Unknown CI job "${options.job}". Known jobs: ${Object.keys(ciJobs).join(', ')}.`
	);
}

// A CI job is a named slice of the ci tier, so the workflow never repeats a step list.
const planned = options.job === null ? tiers[options.tier] : ciJobs[options.job];
const selected = planned.filter(
	(step) => options.only.length === 0 || options.only.includes(step.name)
);
if (selected.length === 0) throw new Error(`No steps matched --only ${options.only.join(',')}.`);
const label = options.job === null ? options.tier : `${options.tier}-${options.job}`;
const logDirectory = gateLogDirectory(reportDirectory, label);

await rm(logDirectory, { recursive: true, force: true });
await mkdir(logDirectory, { recursive: true });

const startedAt = new Date();
const started = Date.now();
const runs = new Map<string, StepRun>();
const width = poolWidth(options.stream);
const concurrentSteps = selected.filter((step) => step.concurrent === true);
const serialSteps = selected.filter((step) => step.concurrent !== true);
// `--bail` in a pool means what it did in a loop: stop at the first failure.
// In-flight steps are killed rather than waited out.
const cancellation = new AbortController();
let bailed = false;

/**
 * Printed on completion, not in plan order, so a slow step never hides the
 * ones already done; the report restores plan order.
 */
async function execute(step: GateStep): Promise<void> {
	if (bailed) return;
	let run: StepRun;
	try {
		run = await runStep(step, options.stream, logDirectory, cancellation.signal);
	} catch (error) {
		// A killed step proves nothing, so it is reported as cancelled rather than
		// as a pass or a failure. Anything else is a real problem starting it.
		if (!cancellation.signal.aborted) throw error;
		console.log(`bail  ${'cancelled'.padStart(6)}  ${step.name}`);
		return;
	}
	runs.set(step.name, run);
	const status = { passed: 'pass', failed: 'FAIL', crashed: 'CRASH' }[run.result.outcome];
	console.log(`${status}  ${formatDuration(run.result.durationMs)}  ${run.result.name}`);
	if (!run.result.ok && options.bail) {
		bailed = true;
		cancellation.abort();
	}
}

// Each step runs in its own process group, so cancelling it kills the tool
// under `bun run` rather than orphaning it. The group misses the terminal's
// Ctrl-C, so the runner forwards it.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		if (bailed) return;
		bailed = true;
		cancellation.abort();
		process.exitCode = 130;
	});
}

const plan =
	concurrentSteps.length > 1 && width > 1
		? `${selected.length} steps, ${concurrentSteps.length} of them ${width} at a time`
		: `${selected.length} steps, one at a time`;
console.log(`Gate ${label}: ${plan}, run to completion.\n`);

if (concurrentSteps.length > 1 && width > 1) await syncGeneratedTypes();
await pooled(concurrentSteps, width, execute);
for (const step of serialSteps) await execute(step);

const results: StepResult[] = [];
const failureOutput = new Map<string, string>();
for (const step of selected) {
	const run = runs.get(step.name);
	if (run === undefined) continue;
	results.push(run.result);
	if (!run.result.ok) failureOutput.set(run.result.name, run.output);
}

const summary = summarizeOutcomes(results);
const notOk = results.filter((result) => !result.ok);
const report = {
	tier: options.tier,
	job: options.job,
	ok: summary.ok,
	startedAt: startedAt.toISOString(),
	durationMs: Date.now() - started,
	stepsRun: results.length,
	stepsPlanned: selected.length,
	failed: summary.failed,
	/** Steps that never produced a verdict. Never evidence about the change. */
	crashed: summary.crashed,
	steps: results
};

await writeFile(gateReportPath(reportDirectory, label), `${JSON.stringify(report, null, 2)}\n`);

for (const result of notOk) printFailure(result, failureOutput.get(result.name) ?? '');

console.log(
	`\nGate ${label}: ${results.length - notOk.length}/${results.length} passed in ${formatDuration(report.durationMs)}.`
);
if (summary.failed.length > 0) console.error(`Failed steps: ${summary.failed.join(', ')}`);
if (summary.crashed.length > 0) {
	console.error(
		`Crashed steps, which produced no verdict and say nothing about the change: ${summary.crashed.join(', ')}`
	);
}
// An interrupted run has already set 130; leaving it alone keeps that signal.
if (!summary.ok) process.exitCode = summaryExitCode(summary);
