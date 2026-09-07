import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportsRoot = path.join(projectRoot, 'reports', 'security');
export const cacheRoot = path.join(projectRoot, '.security-cache');

interface RunOptions {
	allowFailure?: boolean;
	env?: NodeJS.ProcessEnv;
	/** Defaults to the project root; the deploy stages a dependency tree elsewhere. */
	cwd?: string;
}

export async function assertDocker(): Promise<void> {
	try {
		await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}']);
	} catch {
		throw new Error('Docker is required and its daemon must be running.');
	}
}

export async function resetReportDirectory(name: string): Promise<string> {
	const directory = path.join(reportsRoot, name);
	await rm(directory, { recursive: true, force: true });
	await mkdir(directory, { recursive: true });
	return directory;
}

export async function ensureDirectory(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true });
}

export async function run(
	command: string,
	args: string[],
	options: RunOptions = {}
): Promise<number> {
	const exitCode = await new Promise<number>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd ?? projectRoot,
			env: options.env ?? process.env,
			stdio: 'inherit'
		});
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});

	if (exitCode !== 0 && !options.allowFailure) {
		throw new Error(`${command} exited with code ${exitCode}.`);
	}

	return exitCode;
}

export interface CaptureResult {
	exitCode: number;
	/** stdout and stderr interleaved, for logs and human output. */
	output: string;
	/** stdout alone, for callers parsing machine-readable output. */
	stdout: string;
	stderr: string;
}

/**
 * Signal the child's whole process group: a gate step is a `bun run` wrapper
 * around the real tool, and killing the wrapper alone orphans the tool.
 */
function killTree(child: ChildProcess): void {
	if (child.pid === undefined) return;
	try {
		process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
	} catch {
		// Already exited; there is no group left to signal.
	}
}

/** Runs the command to completion without failing on a non-zero exit; callers decide what a failure means. */
export async function captureStatus(
	command: string,
	args: string[],
	options: {
		stream?: boolean;
		env?: NodeJS.ProcessEnv;
		cwd?: string;
		/** Aborting kills the child; the returned promise then rejects. */
		signal?: AbortSignal;
	} = {}
): Promise<CaptureResult> {
	const combined: string[] = [];
	const out: string[] = [];
	const err: string[] = [];
	const cancellable = options.signal !== undefined;
	const exitCode = await new Promise<number>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd ?? projectRoot,
			env: options.env ?? process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			// Own process group so cancel can kill the whole tree; only when the caller asks.
			detached: cancellable
		});
		let cancelled = false;
		const cancel = (): void => {
			cancelled = true;
			killTree(child);
		};
		if (options.signal !== undefined) {
			if (options.signal.aborted) cancel();
			else options.signal.addEventListener('abort', cancel, { once: true });
		}
		for (const [stream, sink] of [
			[child.stdout, out],
			[child.stderr, err]
		] as const) {
			stream.setEncoding('utf8');
			stream.on('data', (chunk: string) => {
				sink.push(chunk);
				combined.push(chunk);
				if (options.stream === true) process.stdout.write(chunk);
			});
		}
		child.on('error', reject);
		child.on('close', (code) => {
			if (cancelled) reject(new Error(`${command} ${args.join(' ')} was cancelled.`));
			else resolve(code ?? 1);
		});
	});

	return { exitCode, output: combined.join(''), stdout: out.join(''), stderr: err.join('') };
}

export async function capture(command: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(command, args, {
		cwd: projectRoot,
		maxBuffer: 10 * 1024 * 1024
	});
	return stdout.trim();
}

export function hostUser(): string {
	const userId = process.getuid?.();
	const groupId = process.getgid?.();
	return userId === undefined || groupId === undefined ? '1000:1000' : `${userId}:${groupId}`;
}

/**
 * The one place `JSON.parse(await readFile(file, 'utf8')) as T` gets written,
 * for every gate and script that reads a committed or generated JSON file.
 * Throws with the file's path relative to the project root so a bad path or
 * an unparsable file names itself in the error rather than in a stack trace.
 */
export async function readJsonFile<T>(file: string): Promise<T> {
	let raw: string;
	try {
		raw = await readFile(file, 'utf8');
	} catch (error) {
		throw new Error(`could not read ${path.relative(projectRoot, file)}`, { cause: error });
	}
	try {
		return JSON.parse(raw) as T;
	} catch (error) {
		throw new Error(`${path.relative(projectRoot, file)} is not parsable JSON.`, { cause: error });
	}
}

/** `readJsonFile`, but a missing or unparsable file resolves to `null` instead of throwing. */
export async function readJsonFileOrNull<T>(file: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as T;
	} catch {
		return null;
	}
}
