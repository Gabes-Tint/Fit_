import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
	APP_PORT,
	CURRENT_LINK,
	deployHost,
	PUBLIC_ORIGIN,
	SSH_OPTIONS,
	remote,
	shellQuote
} from './config';
import { describeRemoval, runAndRemove } from './smoke-cleanup';
import { removeSmokeAccountScript, removedAccounts, smokeUsername } from './smoke-account';
import { REVALIDATE } from '../../src/lib/server/cache-policy';
import { readBuildVersion } from '../build/app-version';
import { capture, projectRoot } from '../security/shared';

/**
 * What "it deployed" means, asserted against the running server rather than
 * against the deploy's own exit code.
 *
 * The registration and sign-in round trip is the point: it is the only path
 * that touches SQLite, the migration list, scrypt and the session cookie at
 * once, so it fails when any of those is misconfigured on the machine. The
 * throwaway account it creates is then removed again — see `smoke-account.ts`
 * for what that is allowed to touch and why a row per deploy is not acceptable
 * as the alternative.
 */

/** Registration counts every attempt from one address, ten to the hour. */
const DOCUMENTATION_PREFIX = '2001:db8::';

/**
 * Whether this run has to stand in for Cloudflare.
 *
 * `ADDRESS_HEADER` names a header the origin trusts, so the origin must never
 * be reachable by anything but the proxy — and Cloudflare enforces the other
 * half of that by refusing, with a 403 of its own, any request that arrives
 * already carrying `CF-Connecting-IP`. Through the public name the proxy sets
 * it; reaching the origin directly, this check has to, or `getClientAddress()`
 * throws and every request is a 500 that proves nothing.
 */
export function standsInForProxy(base: string): boolean {
	return base !== PUBLIC_ORIGIN;
}

/** Long enough for the password floor of 10, and never reused. */
const PASSWORD_BYTES = 16;

/**
 * What only this app puts in a page.
 *
 * A 200 is not evidence: anything at all can be listening on the origin's port,
 * and a static file server answering from an empty directory returns one too.
 * `ssr = false` means the page carries no rendered heading to look for, so the
 * marker is the immutable asset path SvelteKit builds every page's client
 * bootstrap around.
 */
const CLIENT_BUNDLE_PREFIX = '/_app/immutable/';

const REQUEST_TIMEOUT_MS = 30_000;
const TUNNEL_READY_TIMEOUT_MS = 15_000;
const TUNNEL_POLL_MS = 200;

type Check = { name: string; detail: string };

const passed: Check[] = [];

class SmokeFailure extends Error {}

function check(name: string, ok: boolean, detail: string): void {
	if (!ok) throw new SmokeFailure(`${name}: ${detail}`);
	passed.push({ name, detail });
}

type Options = {
	/** Where requests are sent. Not always the origin: see `--tunnel`. */
	base: string;
	/** The origin the app is configured to accept writes from. */
	origin: string;
	/** The release expected to be live. */
	commit: string;
	/** The version string the deploy built, which the served build must agree with. */
	version: string;
	tunnel: boolean;
};

function parseOptions(argv: string[]): Options {
	const flags = new Map<string, string>();
	let tunnel = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index] ?? '';
		if (argument === '--tunnel') {
			tunnel = true;
			continue;
		}
		if (!argument.startsWith('--')) throw new Error(`unexpected argument ${argument}`);
		const value = argv[index + 1];
		if (value === undefined) throw new Error(`${argument} needs a value`);
		flags.set(argument.slice(2), value);
		index += 1;
	}
	return {
		base: (flags.get('base') ?? PUBLIC_ORIGIN).replace(/\/$/, ''),
		origin: flags.get('origin') ?? PUBLIC_ORIGIN,
		commit: flags.get('commit') ?? '',
		version: flags.get('version') ?? '',
		tunnel
	};
}

/** A port the kernel just handed out, released before ssh claims it. */
async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (address === null || typeof address === 'string') {
				reject(new Error('could not reserve a local port'));
				return;
			}
			probe.close(() => resolve(address.port));
		});
	});
}

async function accepts(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ port, host: '127.0.0.1' });
		socket.on('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.on('error', () => resolve(false));
	});
}

/**
 * A local port forwarded to the app's own port on the machine.
 *
 * The public name has to resolve and reach this host before the smoke check
 * can run against the real origin. Until it does, this is how the deployed
 * server is exercised end to end rather than assumed to work.
 */
async function openTunnel(port: number): Promise<ChildProcess> {
	const child = spawn(
		'ssh',
		[...SSH_OPTIONS, '-N', '-L', `127.0.0.1:${port}:127.0.0.1:${APP_PORT}`, deployHost()],
		{ stdio: ['ignore', 'ignore', 'inherit'] }
	);
	const deadline = Date.now() + TUNNEL_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('ssh tunnel exited before it was ready');
		if (await accepts(port)) return child;
		await delay(TUNNEL_POLL_MS);
	}
	child.kill('SIGTERM');
	throw new Error(`ssh tunnel did not accept connections on 127.0.0.1:${port}`);
}

type Client = {
	get: (pathname: string) => Promise<Response>;
	send: (method: string, pathname: string, body?: unknown) => Promise<Response>;
	adopt: (response: Response) => void;
	cookie: () => string | undefined;
};

/**
 * The client Cloudflare would look like: the configured `Origin` on every
 * unsafe method, and — only when this run is standing in for the proxy — the
 * client-address header `ADDRESS_HEADER` names.
 *
 * That address is a fresh one from the documentation range each run, because
 * registration is throttled per address and a fixed one would lock the
 * eleventh deploy of the hour out of its own smoke check. Through Cloudflare
 * there is no such freedom: the address is this machine's, and ten deploys an
 * hour is the ceiling.
 */
function createClient(options: Options): Client {
	const proxyHeaders = standsInForProxy(options.base)
		? { 'cf-connecting-ip': DOCUMENTATION_PREFIX + randomBytes(4).toString('hex') }
		: {};
	let cookie: string | undefined;
	const headers = (extra: Record<string, string>): Record<string, string> => ({
		...proxyHeaders,
		...(cookie === undefined ? {} : { cookie }),
		...extra
	});
	const fetchWith = async (pathname: string, init: RequestInit): Promise<Response> =>
		fetch(`${options.base}${pathname}`, {
			...init,
			redirect: 'manual',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	return {
		get: (pathname) => fetchWith(pathname, { headers: headers({}) }),
		send: (method, pathname, body) =>
			fetchWith(pathname, {
				method,
				headers: headers({ origin: options.origin, 'content-type': 'application/json' }),
				...(body === undefined ? {} : { body: JSON.stringify(body) })
			}),
		adopt: (response) => {
			const issued = response.headers
				.getSetCookie()
				.find((value) => value.startsWith('fit_session='));
			if (issued !== undefined) cookie = issued.split(';')[0];
		},
		cookie: () => cookie
	};
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
	try {
		return (await response.json()) as Record<string, unknown>;
	} catch {
		return {};
	}
}

async function checkSignInPage(client: Client): Promise<void> {
	const response = await client.get('/signin');
	const body = response.status === 200 ? await response.text() : '';
	const shell = body.includes(CLIENT_BUNDLE_PREFIX);
	check(
		'the sign-in page is served by this app',
		response.status === 200 && shell,
		`GET /signin -> ${response.status}${response.status === 200 && !shell ? ', but the body is not this app' : ''}`
	);
}

/**
 * That this deploy will reach the phones already running the last one.
 *
 * The header is set in `hooks.server.ts` and unit-tested there, and the
 * end-to-end run asserts it against a built server. Neither of those sees
 * Cloudflare, and Cloudflare is the half that was never in evidence: the zone
 * carries a four-hour Browser Cache TTL, which it applies to any response it
 * caches whose own lifetime is shorter. A page is `DYNAMIC` today so the header
 * should arrive untouched — but "should" is what left a phone on a morning
 * build for a whole day, and this check is where the edge either honours the
 * origin or the deploy fails saying it did not.
 *
 * Through `--tunnel` this asserts the origin instead, which is the same
 * assertion with Cloudflare taken out of it.
 */
async function checkShellRevalidates(client: Client): Promise<void> {
	const response = await client.get('/');
	const policy = response.headers.get('cache-control');
	check(
		'the page shell must be revalidated before it is reused',
		policy === REVALIDATE,
		`GET / -> cache-control: ${policy ?? '(none)'}`
	);
}

async function checkUnauthenticated(client: Client): Promise<void> {
	const response = await client.get('/api/sessions/current');
	const body = await jsonOf(response);
	const code = (body['error'] as { code?: string } | undefined)?.code;
	check(
		'anonymous session read is refused',
		response.status === 401 && code === 'unauthenticated',
		`GET /api/sessions/current -> ${response.status} ${code ?? '(no code)'}`
	);
}

type Credentials = { username: string; password: string };

function throwawayCredentials(): Credentials {
	return {
		username: smokeUsername(),
		password: randomBytes(PASSWORD_BYTES).toString('base64url')
	};
}

/**
 * The account this run created, taken back out.
 *
 * A reported number rather than a best-effort cleanup: a removal that quietly
 * failed would put the table back on the unbounded path it was on, and nobody
 * would learn that until someone counted the rows.
 */
async function removeAccount(credentials: Credentials): Promise<number> {
	return removedAccounts(await remote(removeSmokeAccountScript(credentials.username)));
}

async function checkRoundTrip(client: Client, credentials: Credentials): Promise<void> {
	const registered = await client.send('POST', '/api/accounts', {
		...credentials,
		displayName: 'Deploy smoke check',
		householdName: 'Deploy smoke check'
	});
	client.adopt(registered);
	check(
		'registration creates an account',
		registered.status === 201 && client.cookie() !== undefined,
		`POST /api/accounts -> ${registered.status} as ${credentials.username}`
	);

	const signedOut = await client.send('DELETE', '/api/sessions/current');
	check(
		'sign-out ends the registration session',
		signedOut.status === 204,
		`DELETE /api/sessions/current -> ${signedOut.status}`
	);

	const signedIn = await client.send('POST', '/api/sessions', credentials);
	client.adopt(signedIn);
	check(
		'sign-in returns a session',
		signedIn.status === 200,
		`POST /api/sessions -> ${signedIn.status}`
	);

	const current = await client.get('/api/sessions/current');
	const body = await jsonOf(current);
	const account = body['account'] as { username?: string } | undefined;
	check(
		'the session reads back as its own account',
		current.status === 200 && account?.username === credentials.username,
		`GET /api/sessions/current -> ${current.status} ${account?.username ?? '(no account)'}`
	);

	const revoked = await client.send('DELETE', '/api/sessions');
	check(
		'the smoke session is revoked',
		revoked.status === 204,
		`DELETE /api/sessions -> ${revoked.status}`
	);
}

/**
 * Which release is live.
 *
 * Read from the symlink over SSH rather than from an endpoint: an endpoint
 * that exists only to answer this is a route in the application, and this
 * question is about the machine.
 */
async function checkRelease(expected: string): Promise<void> {
	const live = (await remote(`readlink -f ${shellQuote(CURRENT_LINK)}`)).trim();
	const released = path.basename(live);
	check(
		'the live release is this commit',
		released === expected,
		`${CURRENT_LINK} -> ${released}, expected ${expected}`
	);
}

/**
 * That the server answering is the build this deploy made.
 *
 * `checkRelease` below asks the machine which directory `current` points at,
 * which proves the symlink moved; it says nothing about what the process
 * serving requests is running, and a unit that failed to restart, an edge that
 * cached the old shell, or a phone holding a stale bundle all leave that
 * assertion true. This one asks the application instead, over the same path a
 * phone uses, and compares it against the exact string the build baked in.
 */
async function checkVersion(client: Client, expected: string): Promise<void> {
	const response = await client.get('/api/version');
	const body = await jsonOf(response);
	const served = body['version'];
	check(
		'the served version is the one this deploy built',
		response.status === 200 && served === expected,
		`GET /api/version -> ${response.status} ${typeof served === 'string' ? served : '(no version)'}, expected ${expected}`
	);
}

async function writeReport(ok: boolean, failure: string | undefined): Promise<void> {
	const directory = path.join(projectRoot, 'reports', 'deploy');
	await mkdir(directory, { recursive: true });
	const report = {
		ok,
		ranAt: new Date().toISOString(),
		passed,
		...(failure === undefined ? {} : { failure })
	};
	await writeFile(path.join(directory, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * Every check, wrapped in the removal of the account they needed.
 *
 * The removal used to be the last check in the line, which made it the one
 * step a failure anywhere above it skipped — see `smoke-cleanup.ts` for the
 * rows that reached production that way. It is now what the checks run
 * inside, and it is still asserted: a run that passed every check and then
 * could not take its row back out is not a clean deploy.
 */
async function runChecks(options: Options): Promise<void> {
	const client = createClient(options);
	const credentials = throwawayCredentials();
	const outcome = await runAndRemove(
		async () => {
			await checkSignInPage(client);
			await checkShellRevalidates(client);
			await checkUnauthenticated(client);
			await checkRoundTrip(client, credentials);
			await checkRelease(options.commit);
			await checkVersion(client, options.version);
		},
		() => removeAccount(credentials)
	);
	if (outcome.failure !== undefined) {
		throw new SmokeFailure(
			`${outcome.failure} — ${describeRemoval(credentials.username, outcome)}`
		);
	}
	check(
		'the smoke account is removed again',
		outcome.removed === 1,
		`deleted ${outcome.removed} account row for ${credentials.username}`
	);
}

export async function smoke(argv: string[]): Promise<boolean> {
	const options = parseOptions(argv);
	if (options.commit === '') {
		options.commit = await capture('git', ['rev-parse', 'HEAD']);
	}
	// Run on its own, this reads the checkout the same way the build would. The
	// deploy passes `--version` instead, because by then the answer is a fact
	// about the artifact it shipped rather than about this working tree.
	if (options.version === '') {
		options.version = readBuildVersion().version;
	}
	let tunnel: ChildProcess | undefined;
	if (options.tunnel) {
		const port = await freePort();
		tunnel = await openTunnel(port);
		options.base = `http://127.0.0.1:${port}`;
	}
	let failure: string | undefined;
	try {
		await runChecks(options);
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	} finally {
		tunnel?.kill('SIGTERM');
	}
	for (const { name, detail } of passed) console.log(`  ok   ${name} — ${detail}`);
	if (failure !== undefined) console.error(`  FAIL ${failure}`);
	await writeReport(failure === undefined, failure);
	console.log(`Smoke check against ${options.base} (origin ${options.origin}).`);
	return failure === undefined;
}

if (import.meta.main) {
	process.exitCode = (await smoke(process.argv.slice(2))) ? 0 : 1;
}
