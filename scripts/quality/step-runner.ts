import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { captureStatus } from '../security/shared';
import { underGateSlice } from '../dev/gate-slice';
import { stepOutcome, type StepOutcome } from './run-outcome';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface LoggedStepResult {
	ok: boolean;
	outcome: StepOutcome;
	exitCode: number;
	durationMs: number;
	log: string;
	output: string;
}

export interface RunLoggedStepOptions {
	env?: NodeJS.ProcessEnv;
	stream?: boolean;
	signal?: AbortSignal;
	/** Log basename, when it must differ from `name` (verify:changed hashes a file list into it). */
	logName?: string;
}

/**
 * The routine `gate.ts` and `verify-changed.ts` both ran by hand: pick a log
 * path from the step name, launch through `underGateSlice` (sliced locally,
 * untouched in CI), capture output with color forced off, write the log, and
 * translate the exit code into a `StepOutcome`. Tier/CI-job decoration
 * (`purpose`, `command`, `artifacts`) stays in `gate.ts`; `verify:changed`'s
 * per-run `extraEnv` and hashed log names stay explicit at the call site via
 * `options`.
 */
export async function runLoggedStep(
	name: string,
	command: string,
	args: string[],
	logDirectory: string,
	options: RunLoggedStepOptions = {}
): Promise<LoggedStepResult> {
	const logName = options.logName ?? name;
	const logPath = path.join(logDirectory, `${logName.replace(/[/:]/g, '-')}.log`);
	const startedAt = Date.now();
	const launch = underGateSlice(command, args);
	const { exitCode, output } = await captureStatus(launch.command, launch.args, {
		...(options.stream === undefined ? {} : { stream: options.stream }),
		...(options.signal === undefined ? {} : { signal: options.signal }),
		env: { ...process.env, ...options.env, FORCE_COLOR: '0' }
	});
	await writeFile(logPath, output);
	return {
		ok: exitCode === 0,
		outcome: stepOutcome(exitCode),
		exitCode,
		durationMs: Date.now() - startedAt,
		log: path.relative(projectRoot, logPath),
		output
	};
}
