import { readFileSync } from 'node:fs';
import path from 'node:path';
import { capture, projectRoot } from '../security/shared';

/**
 * Everything `deploy.ts` and `smoke.ts` both have to agree on: where a release
 * lands, what the unit is called, and how a command reaches the machine.
 *
 * The host is not here and is nowhere in this repository. It is infrastructure
 * Gabriel owns, so it arrives in the environment and the deploy refuses to run
 * without it — a committed hostname would be one more thing to change when the
 * machine moves, and one more thing a public repository says about his network.
 */

/** Names the machine to deploy to. No default: guessing a target is worse than stopping. */
const DEPLOY_HOST_VARIABLE = 'FIT_DEPLOY_HOST';

/** The public origin the app answers under, and the only origin it accepts writes from. */
export const PUBLIC_ORIGIN = 'https://fit.psilva.org';

export const SERVICE_NAME = 'fit';
export const SERVICE_USER = 'fit';
export const APP_ROOT = '/opt/fit';
export const RELEASES_ROOT = `${APP_ROOT}/releases`;
export const CURRENT_LINK = `${APP_ROOT}/current`;
export const STATE_DIRECTORY = '/var/lib/fit';
export const ENV_FILE = '/etc/fit/fit.env';
export const UNIT_FILE = `/etc/systemd/system/${SERVICE_NAME}.service`;

/** Node lives beside the app rather than in the distribution's package set; see `deploy.ts`. */
export const NODE_ROOT = '/opt/node';
export const REMOTE_NODE = `${NODE_ROOT}/bin/node`;

/** The port the unit binds, and what the smoke check's tunnel forwards to. */
export const APP_PORT = 80;

/** How many releases stay on disk. Enough to roll back by hand; the VM has 15 GB. */
export const RELEASES_KEPT = 5;

export const templateDirectory = path.join(projectRoot, 'scripts', 'deploy');

/**
 * `BatchMode` so a missing key fails instead of hanging on a prompt, and a
 * bounded connect so an unreachable machine is a failure rather than a wait.
 */
export const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];

export function deployHost(): string {
	const host = process.env[DEPLOY_HOST_VARIABLE];
	if (host === undefined || host.trim() === '') {
		throw new Error(
			`${DEPLOY_HOST_VARIABLE} must name the deployment target, for example ` +
				`${DEPLOY_HOST_VARIABLE}=user@host bun run deploy`
		);
	}
	return host.trim();
}

/** The Node version both ends run, read from the one file that pins it. */
export function pinnedNodeVersion(): string {
	const pins = readFileSync(path.join(projectRoot, '.tool-versions'), 'utf8');
	const version = /^node (\S+)$/m.exec(pins)?.[1];
	if (version === undefined) throw new Error('.tool-versions does not pin a node version');
	return version;
}

/**
 * Run a shell script on the target as root, and return its output.
 *
 * The script travels base64-encoded rather than quoted onto a command line: a
 * deploy script is full of quotes, heredocs and `$`, and every layer of
 * escaping between here and the remote shell is a way to run something other
 * than what is written here.
 */
export async function remote(script: string): Promise<string> {
	const encoded = Buffer.from(`set -euo pipefail\n${script}`, 'utf8').toString('base64');
	return capture('ssh', [...SSH_OPTIONS, deployHost(), `echo ${encoded} | base64 -d | sudo bash`]);
}

/** Quote a value for the remote shell, for the few places a path is interpolated. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
