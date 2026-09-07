import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	MAX_PASSWORD_VERIFICATION_DERIVATIONS,
	OWASP_SCRYPT,
	passwordProblem,
	passwordVerificationWork,
	verifyPassword,
	verifyPasswordAtPolicy
} from './password';

/**
 * The lowest cost the parser will accept. The production cost (~350 ms per hash)
 * is unaffordable for a suite that hashes on nearly every case.
 */
const CHEAP = { n: 2 ** 12, r: 8, p: 1 };

const PASSWORD = 'correct horse battery staple';

function legacyHash(password: string, cost = CHEAP): string {
	const salt = Buffer.alloc(16, 7);
	const key = scryptSync(password, salt, 32, {
		N: cost.n,
		r: cost.r,
		p: cost.p,
		maxmem: 512 * 1024 * 1024
	});
	return `scrypt$${cost.n}$${cost.r}$${cost.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

describe('passwordProblem', () => {
	it('accepts a passphrase', () => {
		expect(passwordProblem(PASSWORD)).toBeNull();
	});

	it('accepts a password of exactly the minimum length', () => {
		expect(passwordProblem('0123456789')).toBeNull();
	});

	it('rejects a password below the minimum length', () => {
		expect(passwordProblem('012345678')).toBe('too-short');
	});

	it('rejects a password past the length scrypt should be handed', () => {
		expect(passwordProblem('x'.repeat(129))).toBe('too-long');
	});

	it('accepts a password exactly at the bounded KDF input limit', () => {
		expect(passwordProblem('x'.repeat(128))).toBeNull();
	});

	it('imposes no composition rules', () => {
		expect(passwordProblem('aaaaaaaaaaaa')).toBeNull();
	});
});

describe('hashPassword', () => {
	it('records the algorithm and cost alongside the hash', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(stored.split('$').slice(0, 4)).toEqual(['scrypt', '4096', '8', '1']);
	});

	it('salts, so the same password twice gives two different hashes', async () => {
		const [first, second] = await Promise.all([
			hashPassword(PASSWORD, CHEAP),
			hashPassword(PASSWORD, CHEAP)
		]);
		expect(first).not.toBe(second);
	});

	it('defaults to the OWASP cost when none is given', async () => {
		const stored = await hashPassword(PASSWORD);
		expect(stored.split('$')[1]).toBe(String(OWASP_SCRYPT.n));
	});

	it('rejects passwords outside the creation policy', async () => {
		await expect(hashPassword('too short', CHEAP)).rejects.toThrow('password is too short');
		await expect(hashPassword('x'.repeat(129), CHEAP)).rejects.toThrow('password is too long');
	});

	it('rejects non-string input with a precise programmer error', async () => {
		await expect(hashPassword(undefined as unknown as string, CHEAP)).rejects.toThrow(
			'password must be a string'
		);
	});

	it('rejects costs that would be unsafe to derive', async () => {
		for (const cost of [
			{ n: 5000, r: 8, p: 1 },
			{ n: 2 ** 12, r: 33, p: 1 },
			{ n: 2 ** 17, r: 32, p: 1 },
			{ n: 2 ** 17, r: 8, p: 16 }
		]) {
			await expect(hashPassword(PASSWORD, cost)).rejects.toThrow(
				'scrypt cost is outside the supported bounds'
			);
		}
	});

	it('rejects malformed cost objects with the policy error', async () => {
		for (const cost of [
			null,
			{ n: '4096', r: 8, p: 1 },
			{ n: 4096.5, r: 8, p: 1 },
			{ n: 4096, r: 0, p: 1 },
			{ n: 4096, r: 8, p: 0 }
		]) {
			await expect(hashPassword(PASSWORD, cost as never)).rejects.toThrow(
				'scrypt cost is outside the supported bounds'
			);
		}
	});

	it('accepts each individual cost parameter at its supported boundary', async () => {
		await expect(hashPassword(PASSWORD, { n: 2 ** 17, r: 2, p: 1 })).resolves.toContain(
			'scrypt$131072$2$1$'
		);
		await expect(hashPassword(PASSWORD, { n: 2 ** 12, r: 32, p: 1 })).resolves.toContain(
			'scrypt$4096$32$1$'
		);
		await expect(hashPassword(PASSWORD, { n: 2 ** 12, r: 1, p: 16 })).resolves.toContain(
			'scrypt$4096$1$16$'
		);
	});
});

describe('verifyPassword', () => {
	it('accepts the password it was made from', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored)).toBe(true);
	});

	it('rejects a different password', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword('incorrect horse battery staple', stored)).toBe(false);
	});

	it('verifies a hash made at a cost the current default no longer uses', async () => {
		// Parameters travel with the hash, so raising the default must not lock out old registrations.
		const stored = await hashPassword(PASSWORD, { n: 2 ** 13, r: 8, p: 1 });
		expect(await verifyPassword(PASSWORD, stored)).toBe(true);
	});

	it('rejects a hash with the wrong number of fields', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, 'scrypt$4096$8$1$salt')).toBe(false);
		expect(await verifyPassword(PASSWORD, `${stored}$extra`)).toBe(false);
	});

	it('rejects a hash from an algorithm it does not implement', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored.replace('scrypt', 'argon2id'))).toBe(false);
	});

	it('rejects text prefixed to an otherwise valid stored hash', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, `prefix${stored}`)).toBe(false);
	});

	it('rejects a cost low enough to be worth brute-forcing', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored.replace('$4096$', '$2$'))).toBe(false);
	});

	it('rejects a cost high enough to hang the server', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored.replace('$4096$', `$${2 ** 24}$`))).toBe(false);
	});

	it('rejects a non-numeric block size rather than deriving with NaN', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored.replace('$4096$8$', '$4096$eight$'))).toBe(false);
	});

	it.each([
		['n', '$4096$8$1$', '$nope$8$1$'],
		['p', '$4096$8$1$', '$4096$8$nope$'],
		['numeric prefix', '$4096$8$1$', '$4096suffix$8$1$'],
		['numeric suffix', '$4096$8$1$', '$prefix4096$8$1$'],
		['leading zero', '$4096$8$1$', '$04096$8$1$']
	])('rejects a malformed %s cost field', async (_name, from, to) => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored.replace(from, to))).toBe(false);
	});

	it('rejects a stored key of the wrong length without throwing', async () => {
		// Reject this while parsing so malformed database data never reaches the KDF.
		const stored = await hashPassword(PASSWORD, CHEAP);
		const shortKey = Buffer.from('too short').toString('base64');
		expect(
			await verifyPassword(PASSWORD, `${stored.slice(0, stored.lastIndexOf('$'))}$${shortKey}`)
		).toBe(false);
	});

	it('rejects a nonstandard salt length even when its key matches', async () => {
		const salt = Buffer.alloc(17, 7);
		const key = scryptSync(PASSWORD, salt, 32, {
			N: CHEAP.n,
			r: CHEAP.r,
			p: CHEAP.p,
			maxmem: 512 * 1024 * 1024
		});
		const stored = `scrypt$4096$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
		expect(await verifyPassword(PASSWORD, stored)).toBe(false);
	});

	it('rejects non-canonical salt text even when it decodes to the matching salt', async () => {
		const salt = Buffer.alloc(16, 7);
		const key = scryptSync(PASSWORD, salt, 32, {
			N: CHEAP.n,
			r: CHEAP.r,
			p: CHEAP.p,
			maxmem: 512 * 1024 * 1024
		});
		const canonical = salt.toString('base64');
		const nonCanonical = `${canonical.slice(0, -1)} `;
		const stored = `scrypt$4096$8$1$${nonCanonical}$${key.toString('base64')}`;
		expect(await verifyPassword(PASSWORD, stored)).toBe(false);
	});

	it('rejects a non-power-of-two block size without deriving', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored.replace('$4096$', '$5000$'))).toBe(false);
	});

	it('rejects parameters whose aggregate memory or work exceeds the policy', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, stored.replace('$4096$8$1$', '$131072$32$1$'))).toBe(
			false
		);
		expect(await verifyPassword(PASSWORD, stored.replace('$4096$8$1$', '$4096$8$17$'))).toBe(false);
		expect(await verifyPassword(PASSWORD, stored.replace('$4096$8$1$', '$131072$8$16$'))).toBe(
			false
		);
	});

	it('returns false when crypto refuses a policy-shaped stored cost', async () => {
		const salt = Buffer.alloc(16, 7).toString('base64');
		const key = Buffer.alloc(32, 7).toString('base64');
		const stored = `scrypt$${2 ** 17}$1$1$${salt}$${key}`;
		await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
	});

	it('rejects non-canonical base64 and wrong salt lengths without throwing', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		const [algorithm, n, r, p, salt, key] = stored.split('$');
		expect(
			await verifyPassword(PASSWORD, [algorithm, n, r, p, salt?.replace(/=$/, ''), key].join('$'))
		).toBe(false);
		expect(
			await verifyPassword(
				PASSWORD,
				[algorithm, n, r, p, Buffer.from('short').toString('base64'), key].join('$')
			)
		).toBe(false);
		expect(
			await verifyPassword(PASSWORD, [algorithm, n, r, p, salt, key?.replace(/=$/, '')].join('$'))
		).toBe(false);
	});

	it('rejects empty salt and key fields', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		const [algorithm, n, r, p, salt, key] = stored.split('$');
		expect(await verifyPassword(PASSWORD, [algorithm, n, r, p, '', key].join('$'))).toBe(false);
		expect(await verifyPassword(PASSWORD, [algorithm, n, r, p, salt, ''].join('$'))).toBe(false);
	});

	it('returns false for oversized stored hashes and passwords rather than deriving', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(PASSWORD, `${stored}${'x'.repeat(256)}`)).toBe(false);
		expect(await verifyPassword('x'.repeat(129), stored)).toBe(false);
	});

	it('rejects an oversized password even when a legacy key matches it', async () => {
		const password = 'x'.repeat(129);
		expect(await verifyPassword(password, legacyHash(password))).toBe(false);
	});

	it('returns false for non-string passwords and stored hashes', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		expect(await verifyPassword(undefined as unknown as string, stored)).toBe(false);
		expect(await verifyPassword(PASSWORD, null as unknown as string)).toBe(false);
	});

	it('does not coerce a binary database value into a valid stored credential', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		const binary = Buffer.from(stored);
		await expect(verifyPassword(PASSWORD, binary as never)).resolves.toBe(false);
		expect(passwordVerificationWork(binary as never, CHEAP)).toEqual({
			verifyStored: false,
			deriveTarget: true,
			upgradeStored: false,
			derivations: 1
		});
	});

	it('verifies a password exactly at the bounded KDF input limit', async () => {
		const password = 'x'.repeat(128);
		const stored = await hashPassword(password, CHEAP);
		expect(await verifyPassword(password, stored)).toBe(true);
	});
});

describe('passwordVerificationWork', () => {
	it('rejects unsafe targets before inspecting the stored hash', () => {
		expect(() => passwordVerificationWork(null, { n: 5000, r: 8, p: 1 })).toThrow(
			'scrypt cost is outside the supported bounds'
		);
	});

	it('accepts the exact aggregate-work ceiling without starting a derivation', () => {
		expect(passwordVerificationWork(null, { n: 2 ** 13, r: 32, p: 16 })).toEqual({
			verifyStored: false,
			deriveTarget: true,
			upgradeStored: false,
			derivations: 1
		});
	});

	it('rejects a stored hash that is stronger than the target on one axis alone', async () => {
		// Matches n and r but exceeds the target's p: neither the exact-match
		// branch nor the ratchet can take it, so every axis has to be compared on
		// its own rather than folded into one combined check.
		const stored = await hashPassword(PASSWORD, { ...CHEAP, p: 2 });
		expect(passwordVerificationWork(stored, CHEAP)).toEqual({
			verifyStored: false,
			deriveTarget: true,
			upgradeStored: false,
			derivations: 1
		});
	});

	it('upgrades a stored hash that is weaker than the target on one axis alone', async () => {
		// Matches n and p but is weaker than the target's r, so the exact-match
		// branch must not fire and the ratchet must compare r on its own.
		const stored = await hashPassword(PASSWORD, { ...CHEAP, r: 4 });
		expect(passwordVerificationWork(stored, CHEAP)).toEqual({
			verifyStored: true,
			deriveTarget: true,
			upgradeStored: true,
			derivations: 2
		});
	});

	it('accepts current policies with two-digit block-size and parallelism fields', async () => {
		for (const cost of [
			{ ...CHEAP, r: 16 },
			{ ...CHEAP, r: 1, p: 16 }
		]) {
			const stored = await hashPassword(PASSWORD, cost);
			expect(passwordVerificationWork(stored, cost)).toEqual({
				verifyStored: true,
				deriveTarget: false,
				upgradeStored: false,
				derivations: 1
			});
		}
	});

	it('pads malformed cost and salt fields instead of crashing or skipping target work', async () => {
		const stored = await hashPassword(PASSWORD, CHEAP);
		const [algorithm, n, r, p, , key] = stored.split('$');
		const malformed = [
			stored.replace(`$${n}$`, '$5000$'),
			[algorithm, n, r, p, '!'.repeat(24), key].join('$')
		];
		for (const candidate of malformed) {
			expect(passwordVerificationWork(candidate, CHEAP)).toEqual({
				verifyStored: false,
				deriveTarget: true,
				upgradeStored: false,
				derivations: 1
			});
			await expect(verifyPasswordAtPolicy(PASSWORD, candidate, CHEAP)).resolves.toEqual({
				verified: false,
				upgradeHash: null
			});
		}
	});

	it('bounds every policy case to at most two derivations', async () => {
		const oldHash = await hashPassword(PASSWORD, CHEAP);
		const target = { ...CHEAP, n: 2 ** 13 };
		const targetHash = await hashPassword(PASSWORD, target);
		const strongerHash = await hashPassword(PASSWORD, { ...target, n: 2 ** 14 });
		const incomparableHash = await hashPassword(PASSWORD, { ...CHEAP, r: 16 });
		const plans = [
			passwordVerificationWork(null, target),
			passwordVerificationWork('unreadable', target),
			passwordVerificationWork(oldHash, target),
			passwordVerificationWork(targetHash, target),
			passwordVerificationWork(strongerHash, target),
			passwordVerificationWork(incomparableHash, target)
		];
		expect(plans).toEqual([
			{ verifyStored: false, deriveTarget: true, upgradeStored: false, derivations: 1 },
			{ verifyStored: false, deriveTarget: true, upgradeStored: false, derivations: 1 },
			{ verifyStored: true, deriveTarget: true, upgradeStored: true, derivations: 2 },
			{ verifyStored: true, deriveTarget: false, upgradeStored: false, derivations: 1 },
			{ verifyStored: false, deriveTarget: true, upgradeStored: false, derivations: 1 },
			{ verifyStored: false, deriveTarget: true, upgradeStored: false, derivations: 1 }
		]);
		expect(plans.every((plan) => plan.derivations <= MAX_PASSWORD_VERIFICATION_DERIVATIONS)).toBe(
			true
		);
		expect(
			plans.every(
				(plan) => plan.derivations === Number(plan.verifyStored) + Number(plan.deriveTarget)
			)
		).toBe(true);
	});
});

describe('verifyPasswordAtPolicy', () => {
	it('returns the target-policy candidate produced while verifying an older hash', async () => {
		const oldHash = await hashPassword(PASSWORD, CHEAP);
		const target = { ...CHEAP, n: 2 ** 13 };
		const result = await verifyPasswordAtPolicy(PASSWORD, oldHash, target);
		expect(result.verified).toBe(true);
		expect(result.upgradeHash?.split('$').slice(1, 4)).toEqual(['8192', '8', '1']);
		expect(await verifyPassword(PASSWORD, result.upgradeHash ?? '')).toBe(true);
		expect(await verifyPasswordAtPolicy('incorrect horse battery', oldHash, target)).toEqual({
			verified: false,
			upgradeHash: null
		});
	});

	it('authenticates a short legacy password without replacing it with the padding hash', async () => {
		const shortPassword = 'short';
		const stored = legacyHash(shortPassword);
		const result = await verifyPasswordAtPolicy(shortPassword, stored, { ...CHEAP, n: 2 ** 13 });
		expect(result).toEqual({ verified: true, upgradeHash: null });
	});

	it('performs target-policy work and returns false for an unknown username', async () => {
		expect(await verifyPasswordAtPolicy(PASSWORD, null, CHEAP)).toEqual({
			verified: false,
			upgradeHash: null
		});
	});

	it('fails closed without deriving at a stronger or incomparable stored policy', async () => {
		const target = { ...CHEAP, n: 2 ** 13 };
		const strongerHash = await hashPassword(PASSWORD, { ...target, n: 2 ** 14 });
		const incomparableHash = await hashPassword(PASSWORD, { ...CHEAP, r: 16 });
		await expect(verifyPasswordAtPolicy(PASSWORD, strongerHash, target)).resolves.toEqual({
			verified: false,
			upgradeHash: null
		});
		await expect(verifyPasswordAtPolicy(PASSWORD, incomparableHash, target)).resolves.toEqual({
			verified: false,
			upgradeHash: null
		});
	});
});
