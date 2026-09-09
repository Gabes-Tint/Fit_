import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	CI_REASON,
	GATE_SLICE,
	HEAVIEST_STEP_GIGABYTES,
	STEP_MEMORY_MAX,
	decideSliceCommand,
	gigabytes,
	sliceUnitPath,
	userManagerCgroup
} from './gate-slice';

const supported = {
	ci: false,
	systemdRun: '/usr/bin/systemd-run',
	memoryDelegated: true,
	sliceInstalled: true
};

describe('choosing how to launch a gate step', () => {
	it('runs the step inside the shared slice, capped, when the machine supports it', () => {
		expect(decideSliceCommand('bun', ['run', 'lint'], supported)).toEqual({
			command: '/usr/bin/systemd-run',
			args: [
				'--user',
				`--slice=${GATE_SLICE}`,
				'--scope',
				'--quiet',
				'--collect',
				'-p',
				`MemoryMax=${STEP_MEMORY_MAX}`,
				'--',
				'bun',
				'run',
				'lint'
			],
			unwrappedBecause: null
		});
	});

	it('leaves CI completely alone', () => {
		expect(decideSliceCommand('bun', ['run', 'lint'], { ...supported, ci: true })).toEqual({
			command: 'bun',
			args: ['run', 'lint'],
			unwrappedBecause: CI_REASON
		});
	});

	it('runs the step directly when systemd-run is absent', () => {
		const decision = decideSliceCommand('bunx', ['vitest', 'run'], {
			...supported,
			systemdRun: null
		});
		expect({ command: decision.command, args: decision.args }).toEqual({
			command: 'bunx',
			args: ['vitest', 'run']
		});
		expect(decision.unwrappedBecause).toBe('systemd-run is not on PATH');
	});

	it('runs the step directly when the session has no delegated memory controller', () => {
		const decision = decideSliceCommand('bun', ['run', 'lint'], {
			...supported,
			memoryDelegated: false
		});
		expect(decision.command).toBe('bun');
		expect(decision.unwrappedBecause).toContain('memory controller');
	});

	/**
	 * The regression that matters most: `systemd-run --slice=` creates a missing
	 * slice implicitly with no limit on it, so wrapping against an uninstalled
	 * unit would look like a ceiling and enforce nothing.
	 */
	it('runs the step directly, naming the installer, when the slice unit is not installed', () => {
		const decision = decideSliceCommand('bun', ['run', 'lint'], {
			...supported,
			sliceInstalled: false
		});
		expect(decision.command).toBe('bun');
		expect(decision.args).toEqual(['run', 'lint']);
		expect(decision.unwrappedBecause).toBe(
			`${GATE_SLICE} is not installed — bun run dev:gate-slice`
		);
	});

	it('never mutates the caller’s argument list', () => {
		const args = ['run', 'lint'];
		decideSliceCommand('bun', args, supported);
		expect(args).toEqual(['run', 'lint']);
	});
});

describe('finding the user manager cgroup', () => {
	it('stops at user@<uid>.service, ignoring the escaped names below it', () => {
		expect(
			userManagerCgroup(
				'0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-Hyprland-xdg\\x2dterminal\\x2dexec-51224cfe.scope\n'
			)
		).toBe('/user.slice/user-1000.slice/user@1000.service');
	});

	it('has no answer for a process outside a user session', () => {
		expect(userManagerCgroup('0::/system.slice/sshd.service\n')).toBeNull();
	});

	it('has no answer without a cgroup v2 line', () => {
		expect(userManagerCgroup('1:name=systemd:/user.slice\n')).toBeNull();
	});
});

describe('locating the installed unit', () => {
	it('follows XDG_CONFIG_HOME when it is set', () => {
		expect(sliceUnitPath({ XDG_CONFIG_HOME: '/xdg' }, '/home/gabriel')).toBe(
			`/xdg/systemd/user/${GATE_SLICE}`
		);
	});

	it('falls back to ~/.config when it is unset or empty', () => {
		expect(sliceUnitPath({}, '/home/gabriel')).toBe(
			`/home/gabriel/.config/systemd/user/${GATE_SLICE}`
		);
		expect(sliceUnitPath({ XDG_CONFIG_HOME: '' }, '/home/gabriel')).toBe(
			`/home/gabriel/.config/systemd/user/${GATE_SLICE}`
		);
	});
});

/**
 * The two numbers are one design and drifted apart the first time they were
 * chosen independently: a 6 GB per-step cap under an 18 GB ceiling OOM-killed a
 * passing `lint`, and a gate killed that way reports a crash, which is no
 * verdict about the change at all.
 */
describe('sizing the per-step cap against the slice ceiling', () => {
	const unit = readFileSync(
		path.join(fileURLToPath(new URL('.', import.meta.url)), GATE_SLICE),
		'utf8'
	);

	function unitLimit(key: string): string {
		const matched = new RegExp(`^${key}=(.+)$`, 'm').exec(unit);
		if (matched === null) throw new Error(`${GATE_SLICE} declares no ${key}.`);
		return matched[1] ?? '';
	}

	it('declares the ceiling and a swap limit on the slice itself', () => {
		// `systemd-run -p MemoryMax=` would set the scope's limit, never the
		// parent slice's, so the ceiling only exists if the unit file states it.
		expect(unitLimit('MemoryMax')).toBe('18G');
		expect(unitLimit('MemorySwapMax')).toBe('2G');
	});

	it('leaves the heaviest step real headroom rather than sitting on its peak', () => {
		// A cap trimmed to the measured peak turns every ordinary run-to-run
		// wobble, and every test added after the measurement, into an OOM kill
		// reported as a crash. #198 raised this cap rather than let that happen;
		// the ratio is what stops a later tightening from re-earning it.
		expect(gigabytes(STEP_MEMORY_MAX)).toBeGreaterThanOrEqual(HEAVIEST_STEP_GIGABYTES * 1.5);
	});

	it('caps one step below the ceiling, so the cap still bounds a runaway', () => {
		expect(gigabytes(STEP_MEMORY_MAX)).toBeLessThan(gigabytes(unitLimit('MemoryMax')));
	});
});

describe('reading a memory limit', () => {
	it('reads the gigabyte form', () => {
		expect(gigabytes('18G')).toBe(18);
		expect(gigabytes('9.3G')).toBe(9.3);
	});

	it('refuses a limit it cannot compare', () => {
		expect(() => gigabytes('infinity')).toThrow('Not a gigabyte memory limit');
		expect(() => gigabytes('512M')).toThrow('Not a gigabyte memory limit');
	});
});
