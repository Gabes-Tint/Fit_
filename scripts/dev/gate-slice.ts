/**
 * Issue #191: `systemd-oomd` killed the Claude Code app scope twice, because
 * every gate sizes itself to the whole machine and several agents run gates at
 * once. Capping each gate on its own does not bound the total — five worktrees
 * capped at 6 GB still ask for 30 GB — so the ceiling lives on a shared parent
 * cgroup instead, and each gate step runs in a transient scope inside it.
 *
 * A user slice is a named cgroup under the user session rather than something
 * one process owns, so every gate step launched by any Claude Code instance on
 * this machine joins the same cgroup and the kernel accounts them together.
 * That is why this is systemd and not an in-process semaphore, which would only
 * ever know its own process tree.
 *
 * This is a workstation concern only. Under CI the wrapping is skipped
 * outright, and anywhere the mechanism is missing the command runs directly
 * with a notice: a gate that cannot be sliced still has to produce its verdict.
 */
import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const GATE_SLICE = 'fit-gates.slice';

/**
 * The blast radius of one step, not the ceiling. `fit-gates.slice` carries the
 * ceiling; this only decides that a single runaway step dies alone and says so,
 * instead of dragging its siblings down with it.
 *
 * It has to sit above the honest peak of the heaviest step or it stops being a
 * runaway detector and becomes a cause of failure: at 6 GB the kernel
 * OOM-killed a passing `lint`, which a gate reports as a crash — no verdict,
 * and so no evidence about the change either way.
 *
 * The number stays at 12 GB after #198, for a different reason than it was
 * first chosen. That issue took `lint` from 9.3 GB to 2.4 GB and expected the
 * cap to fall with it; measuring the rest of the tier first showed that it
 * cannot, because `lint` was no longer the step this bounds. `test:unit` peaks
 * at 9.6 GB, and 12 GB is the smallest cap that still clears it with room.
 * Lowering it on the strength of the lint fix alone would have killed a
 * passing test run — the very failure the paragraph above describes.
 */
export const STEP_MEMORY_MAX = '12G';

/**
 * The largest honest peak measured for a single gate step on this workstation:
 * `test:unit`, 9.6 GB (2026-09-08), of which the Chromium `client` project is
 * 8.1 GB on its own. Recorded so the per-step cap cannot drift back below it:
 * a cap under this number does not catch runaways, it kills passing gates.
 *
 * It named `lint` at 9.3 GB until #198. That reading was correct when taken and
 * is simply no longer the largest — the same command now peaks at 2.4 GB — so
 * what changed here is which step the number is about, not the standard it
 * holds the cap to. Bounding the browser suite is what would let the cap move.
 */
export const HEAVIEST_STEP_GIGABYTES = 9.7;

/** Parses the `<n>G` form both the unit file and the per-step cap are written in. */
export function gigabytes(limit: string): number {
	const matched = /^(\d+(?:\.\d+)?)G$/.exec(limit.trim());
	if (matched === null) throw new Error(`Not a gigabyte memory limit: ${limit}`);
	return Number(matched[1]);
}

export interface SliceSupport {
	/** Set on a hosted runner. CI is bounded by the runner, and must not change. */
	ci: boolean;
	/** Absolute path to `systemd-run`, or null where there is none. */
	systemdRun: string | null;
	/** Whether the user manager may create memory-limited children. */
	memoryDelegated: boolean;
	/** Whether the unit declaring the ceiling has been installed. */
	sliceInstalled: boolean;
}

export interface SliceDecision {
	command: string;
	args: string[];
	/** Why the command was left unwrapped, or null when it was wrapped. */
	unwrappedBecause: string | null;
}

/** The reason string for CI, which is a deliberate skip rather than a shortfall. */
export const CI_REASON = 'this is CI, which the hosted runner already bounds';

/**
 * Pure: given what the environment supports, either the `systemd-run` form of
 * the command or the command untouched with the reason it was left alone.
 *
 * An uninstalled slice counts as unsupported on purpose. `systemd-run
 * --slice=fit-gates.slice` happily creates the slice implicitly, with no limit
 * on it at all, which would look exactly like a working ceiling and enforce
 * nothing.
 */
export function decideSliceCommand(
	command: string,
	args: readonly string[],
	support: SliceSupport
): SliceDecision {
	const direct = { command, args: [...args] };
	if (support.ci) return { ...direct, unwrappedBecause: CI_REASON };
	if (support.systemdRun === null) {
		return { ...direct, unwrappedBecause: 'systemd-run is not on PATH' };
	}
	if (!support.memoryDelegated) {
		return {
			...direct,
			unwrappedBecause: 'this user session has no delegated memory controller'
		};
	}
	if (!support.sliceInstalled) {
		return {
			...direct,
			unwrappedBecause: `${GATE_SLICE} is not installed — bun run dev:gate-slice`
		};
	}
	return {
		command: support.systemdRun,
		args: [
			'--user',
			`--slice=${GATE_SLICE}`,
			'--scope',
			// Without these systemd narrates the scope on stderr and leaves a
			// failed unit behind; a gate's captured log has to stay the gate's.
			'--quiet',
			'--collect',
			'-p',
			`MemoryMax=${STEP_MEMORY_MAX}`,
			'--',
			command,
			...args
		],
		unwrappedBecause: null
	};
}

/** Pure: where the installed unit lives, honouring `XDG_CONFIG_HOME`. */
export function sliceUnitPath(environment: NodeJS.ProcessEnv, home: string): string {
	const configHome = environment['XDG_CONFIG_HOME'];
	const base =
		configHome !== undefined && configHome.length > 0 ? configHome : path.join(home, '.config');
	return path.join(base, 'systemd', 'user', GATE_SLICE);
}

/**
 * Pure: the cgroup path of the user manager, read out of `/proc/self/cgroup`.
 * Its `cgroup.subtree_control` is what says whether a child slice can carry a
 * memory limit at all. Only the segments up to `user@<uid>.service` are used,
 * so the systemd-escaped names further down never have to be decoded.
 */
export function userManagerCgroup(procSelfCgroup: string): string | null {
	const line = procSelfCgroup.split('\n').find((entry) => entry.startsWith('0::'));
	if (line === undefined) return null;
	const segments = line.slice('0::'.length).split('/');
	const index = segments.findIndex((segment) => /^user@\d+\.service$/.test(segment));
	return index === -1 ? null : segments.slice(0, index + 1).join('/');
}

function findSystemdRun(environment: NodeJS.ProcessEnv): string | null {
	for (const directory of (environment['PATH'] ?? '').split(path.delimiter)) {
		if (directory.length === 0) continue;
		const candidate = path.join(directory, 'systemd-run');
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not here; keep walking PATH.
		}
	}
	return null;
}

function memoryIsDelegated(): boolean {
	try {
		const manager = userManagerCgroup(readFileSync('/proc/self/cgroup', 'utf8'));
		if (manager === null) return false;
		const control = readFileSync(
			path.join('/sys/fs/cgroup', manager, 'cgroup.subtree_control'),
			'utf8'
		);
		return control.split(/\s+/).includes('memory');
	} catch {
		return false;
	}
}

function unitIsInstalled(environment: NodeJS.ProcessEnv): boolean {
	try {
		accessSync(sliceUnitPath(environment, homedir()), constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

let cachedSupport: SliceSupport | undefined;

/** What this machine supports, probed once per process. */
function sliceSupport(): SliceSupport {
	if (cachedSupport !== undefined) return cachedSupport;
	const ci = process.env['CI'] !== undefined && process.env['CI'] !== '';
	// Nothing is probed under CI: the skip has to be free of any filesystem or
	// PATH behavior that could differ on a runner.
	cachedSupport = ci
		? { ci, systemdRun: null, memoryDelegated: false, sliceInstalled: false }
		: {
				ci,
				systemdRun: findSystemdRun(process.env),
				memoryDelegated: memoryIsDelegated(),
				sliceInstalled: unitIsInstalled(process.env)
			};
	return cachedSupport;
}

let noticed = false;

/**
 * The command to actually spawn for one gate step. Exit code, stdout and
 * stderr are the child's either way, so callers keep their reports and logs
 * unchanged.
 */
export function underGateSlice(
	command: string,
	args: readonly string[]
): { command: string; args: string[] } {
	const decision = decideSliceCommand(command, args, sliceSupport());
	if (decision.unwrappedBecause !== null && decision.unwrappedBecause !== CI_REASON && !noticed) {
		noticed = true;
		console.log(`Gate memory slice: running unbounded — ${decision.unwrappedBecause}.`);
	}
	return { command: decision.command, args: decision.args };
}
