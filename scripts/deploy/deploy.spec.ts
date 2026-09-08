import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { installFile } from './deploy';
import { hostUser } from '../security/shared';
import { addressSource } from '../../src/lib/server/client-address';
import { catalogPath } from '../../src/lib/server/catalog/connection';
import { applicationDatabasePath } from '../../src/lib/server/db';
import { configuredOrigins } from '../../src/lib/server/origin-policy';
import {
	APP_PORT,
	CURRENT_LINK,
	ENV_FILE,
	PUBLIC_ORIGIN,
	REMOTE_NODE,
	SERVICE_USER,
	STATE_DIRECTORY,
	deployHost,
	shellQuote,
	templateDirectory
} from './config';
import { standsInForProxy } from './smoke';

/**
 * The two files this deploy installs on the machine have to agree with each
 * other and with the server that reads them, and nothing at runtime would say
 * so: a wrong `ADDRESS_HEADER` buckets every visitor together in the sign-in
 * throttle, a wrong `ORIGIN` refuses every sign-in, and a privileged `PORT`
 * without the matching capability leaves the unit crash-looping on a port
 * Cloudflare is already pointed at. Each is a deploy that looks like it worked.
 *
 * So the templates are checked against the modules that actually read them
 * rather than against a second copy of the same expectation.
 */

const DEPLOY_HOST_VARIABLE = 'FIT_DEPLOY_HOST';

/** The highest port a process needs `CAP_NET_BIND_SERVICE` to bind. */
const LAST_PRIVILEGED_PORT = 1023;

function template(name: string): string {
	return readFileSync(path.join(templateDirectory, name), 'utf8');
}

/** `KEY=value` lines, which is all `systemd`'s `EnvironmentFile` reads here. */
function environmentTemplate(): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of template('fit.env.example').split('\n')) {
		const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
		if (match?.[1] !== undefined) values[match[1]] = match[2] ?? '';
	}
	return values;
}

/** Unit directives, values collected per key: `systemd` allows a key more than once. */
function unitDirectives(): Map<string, string[]> {
	const directives = new Map<string, string[]>();
	for (const line of template('fit.service').split('\n')) {
		const match = /^([A-Za-z]+)=(.*)$/.exec(line.trim());
		const key = match?.[1];
		if (key === undefined) continue;
		directives.set(key, [...(directives.get(key) ?? []), match?.[2] ?? '']);
	}
	return directives;
}

function directive(name: string): string {
	const values = unitDirectives().get(name) ?? [];
	expect(values, `${name} is set exactly once in fit.service`).toHaveLength(1);
	return values[0] ?? '';
}

describe('the deployment target', () => {
	beforeEach(() => {
		delete process.env[DEPLOY_HOST_VARIABLE];
	});

	it('comes from the environment', () => {
		process.env[DEPLOY_HOST_VARIABLE] = '  someone@somewhere  ';
		expect(deployHost()).toBe('someone@somewhere');
	});

	it('has no default, so a machine is never guessed', () => {
		expect(() => deployHost()).toThrow(DEPLOY_HOST_VARIABLE);
	});

	it('is not answered by a blank variable either', () => {
		process.env[DEPLOY_HOST_VARIABLE] = '   ';
		expect(() => deployHost()).toThrow(DEPLOY_HOST_VARIABLE);
	});

	it('never appears in the files installed on the machine', () => {
		// The public origin belongs in them; the SSH hostname does not, and a
		// template is the easiest place for one to be pasted "just for now".
		for (const name of ['fit.env.example', 'fit.service']) {
			expect(template(name)).not.toMatch(/@[\w.-]+\.[a-z]{2,}/i);
		}
	});
});

describe('the environment file the deploy installs', () => {
	it('declares the origin the app answers under', () => {
		expect(configuredOrigins(environmentTemplate())).toEqual([PUBLIC_ORIGIN]);
	});

	it('keys the sign-in throttle on the visitor Cloudflare names', () => {
		const environment = environmentTemplate();
		expect(addressSource(environment)).toBe('forwarded');
		// adapter-node lower-cases the name before looking the header up, so a
		// name written with capitals silently never matches.
		expect(environment['ADDRESS_HEADER']).toBe('cf-connecting-ip');
	});

	it('puts the database in the directory the unit may write', () => {
		const database = applicationDatabasePath(environmentTemplate()['FIT_DB_PATH']);
		expect(path.dirname(database)).toBe(STATE_DIRECTORY);
		expect(directive('ReadWritePaths')).toBe(STATE_DIRECTORY);
		expect(directive('ProtectSystem')).toBe('strict');
	});

	it('points at a food catalog the unit can read but no release can replace', () => {
		const catalog = catalogPath(environmentTemplate()['FIT_CATALOG_PATH']);
		// Under the state directory, so ProtectSystem=strict does not hide it,
		// and outside the release tree, so a deploy cannot replace or delete the
		// 365 MB file it never ships.
		expect(catalog.startsWith(`${STATE_DIRECTORY}/`)).toBe(true);
		expect(path.dirname(catalog)).not.toBe(STATE_DIRECTORY);
	});

	it('creates that database private to the service user', () => {
		// db.ts narrows app.sqlite and its -wal and -shm to 0600, but only after
		// SQLite has created them under systemd's default 0022 umask. Today only
		// the 0700 on the directory closes that window; one `chmod o+x` on it
		// would publish password hashes. The unit creates them private instead.
		expect(directive('UMask')).toBe('0077');
	});

	it('binds the port the deploy waits on', () => {
		expect(Number(environmentTemplate()['PORT'])).toBe(APP_PORT);
	});
});

describe('the service unit', () => {
	it('runs as the unprivileged service user', () => {
		expect(directive('User')).toBe(SERVICE_USER);
		expect(directive('NoNewPrivileges')).toBe('true');
	});

	it('grants exactly the capability a privileged port needs, and no more', () => {
		// The pairing is the point: this is the one privilege the unit keeps, and
		// it is kept only because the environment file asks for a port below 1024.
		const privileged = Number(environmentTemplate()['PORT']) <= LAST_PRIVILEGED_PORT;
		expect(privileged).toBe(true);
		expect(directive('AmbientCapabilities')).toBe('CAP_NET_BIND_SERVICE');
		expect(directive('CapabilityBoundingSet')).toBe('CAP_NET_BIND_SERVICE');
	});

	it('starts the release the deploy switched to, with the pinned runtime', () => {
		expect(directive('WorkingDirectory')).toBe(CURRENT_LINK);
		expect(directive('ExecStart')).toBe(`${REMOTE_NODE} build`);
		expect(directive('EnvironmentFile')).toBe(ENV_FILE);
	});
});

describe('shellQuote', () => {
	it('closes and reopens the quote around an embedded one', () => {
		expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
	});
});

describe('the smoke check\u2019s client-address header', () => {
	it('is left to Cloudflare on the public origin', () => {
		// Cloudflare answers 403 to a request that already carries
		// `CF-Connecting-IP`, so sending one turns every check into a proxy error.
		expect(standsInForProxy(PUBLIC_ORIGIN)).toBe(false);
	});

	it('is supplied when the check reaches the origin directly', () => {
		// Nothing else would set it, and `getClientAddress()` throws without it.
		expect(standsInForProxy('http://127.0.0.1:41234')).toBe(true);
	});
});

describe('installing a template on the machine', () => {
	const bash = promisify(execFile);
	let scratch: string | undefined;

	afterAll(async () => {
		if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
	});

	/** As the machine runs it, except owned by whoever is running the test. */
	async function install(contents: string, destination: string): Promise<string> {
		const command = installFile(contents, destination, '0644', hostUser());
		await bash('bash', ['-euo', 'pipefail', '-c', command]);
		return readFile(destination, 'utf8');
	}

	it('names its source, rather than reading the shell\u2019s standard input', () => {
		// uutils coreutils, which Ubuntu 26.04 ships, cannot install from
		// `/dev/stdin` onto a destination that exists. GNU coreutils can, so a
		// host running GNU cannot tell you this by failing; the shape has to be
		// asserted directly.
		expect(installFile('x\n', '/etc/fit/fit.env', '0600')).not.toContain('/dev/stdin');
	});

	it('writes the same bytes over a destination that already exists', async () => {
		// The first deploy of a machine creates these files and every one after
		// replaces them, so only the second install can show this failing.
		scratch = await mkdtemp(path.join(os.tmpdir(), 'fit-deploy-'));
		const destination = path.join(scratch, 'fit.service');
		expect(await install('first\n', destination)).toBe('first\n');
		expect(await install('second\n', destination)).toBe('second\n');
	});

	it('is one command, so a caller may put it after `||`', async () => {
		// `A || B && C` runs C either way. The deploy writes the environment file
		// only when it is absent, and that guard is exactly this shape.
		const destination = path.join(scratch ?? os.tmpdir(), 'guarded');
		await bash('bash', [
			'-euo',
			'pipefail',
			'-c',
			`true || ${installFile('unwanted\n', destination, '0644', hostUser())}`
		]);
		await expect(readFile(destination, 'utf8')).rejects.toThrow('ENOENT');
	});

	it('carries content the shell would otherwise interpret', async () => {
		const destination = path.join(scratch ?? os.tmpdir(), 'literal');
		const awkward = 'ExecStart=/opt/node/bin/node build $HOME `id` "quoted" \\\n';
		expect(await install(awkward, destination)).toBe(awkward);
	});

	it('leaves no staged file behind when a step after mktemp fails', async () => {
		// An owner no user on the test machine can `chown` to makes that step
		// fail without touching the filesystem otherwise, which is the shape of
		// a failure a real deploy could hit (e.g. a bad mode or a full disk).
		const directory = await mkdtemp(path.join(os.tmpdir(), 'fit-deploy-fail-'));
		const destination = path.join(directory, 'fit.service');
		const command = installFile(
			'doomed\n',
			destination,
			'0644',
			'nonexistent-owner:nonexistent-group'
		);
		await expect(bash('bash', ['-euo', 'pipefail', '-c', command])).rejects.toThrow();
		expect(await readdir(directory)).toEqual([]);
		await rm(directory, { recursive: true, force: true });
	});
});
