import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/** Why a password was rejected. Codes rather than sentences, so the interface owns the wording. */
export type PasswordProblem = 'too-short' | 'too-long';

export type ScryptCost = { n: number; r: number; p: number };

/**
 * OWASP's scrypt baseline, roughly 350 ms per hash.
 * Passed explicitly rather than read from a global so tests can run a cheaper cost.
 */
export const OWASP_SCRYPT: ScryptCost = { n: 2 ** 17, r: 8, p: 1 };

const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** scrypt needs `128 * n * r` bytes; Node's default cap of 32 MB is below what OWASP asks for. */
const MAX_MEMORY = 512 * 1024 * 1024;

/** scrypt's work grows with all three parameters, not just its memory cost. */
const MAX_WORK = 2 ** 22;

/**
 * The password is the only factor, so the floor sits above the NIST minimum of 8.
 * No composition rules: they push people to a short password decorated to satisfy them.
 */
const MIN_LENGTH = 10;

/** NIST's guidance again: accept long passphrases, but do not hand scrypt unbounded input. */
export const MAX_PASSWORD_LENGTH = 128;

/** Guards a cost read back out of the database against a value that would hang the server. */
const MIN_COST = 2 ** 12;
const MAX_COST = 2 ** 17;
const MAX_R = 32;
const MAX_P = 16;

/**
 * The fixed-width grammar rejects a hostile database value without allocating
 * substrings proportional to its size; canonical base64 is checked after the match.
 */
const SERIALIZED_HASH =
	/^scrypt\$([0-9]{1,6})\$([0-9]{1,2})\$([0-9]{1,2})\$([^$]{24})\$([^$]{44})$/;
const UNKNOWN_USERNAME_PASSWORD = 'unknown user timing guard';

/** No authentication attempt is allowed to start more than this many KDFs. */
export const MAX_PASSWORD_VERIFICATION_DERIVATIONS = 2;

function isBoundedPassword(password: unknown): password is string {
	return typeof password === 'string' && password.length <= MAX_PASSWORD_LENGTH;
}

const deriveScrypt = promisify(scrypt) as unknown as (
	password: string,
	salt: Buffer,
	keyLength: number,
	options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

async function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
	const options = { N: cost.n, r: cost.r, p: cost.p, maxmem: MAX_MEMORY };
	return await deriveScrypt(password, salt, KEY_BYTES, options);
}

/** `null` when the password is usable, otherwise the reason it is not. */
export function passwordProblem(password: string): PasswordProblem | null {
	if (password.length < MIN_LENGTH) return 'too-short';
	if (password.length > MAX_PASSWORD_LENGTH) return 'too-long';
	return null;
}

function assertHashablePassword(password: unknown): asserts password is string {
	if (typeof password !== 'string') throw new TypeError('password must be a string');
	const problem = passwordProblem(password);
	if (problem) throw new RangeError(`password is ${problem.replace('-', ' ')}`);
}

/**
 * A self-describing hash: `scrypt$n$r$p$salt$key`, both binary fields base64.
 * Parameters travel with the hash, so raising the cost is a rehash on next
 * sign-in, never a migration over stored rows.
 */
export async function hashPassword(password: string, cost = OWASP_SCRYPT): Promise<string> {
	assertHashablePassword(password);
	if (!saneCost(cost)) throw new RangeError('scrypt cost is outside the supported bounds');
	const salt = randomBytes(SALT_BYTES);
	const key = await derive(password, salt, cost);
	const encoded = `${salt.toString('base64')}$${key.toString('base64')}`;
	return `scrypt$${cost.n}$${cost.r}$${cost.p}$${encoded}`;
}

/** Whether a cost read back out of the database is one worth deriving with. */
function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
	const number = value as number;
	return Number.isSafeInteger(value) && number >= minimum && number <= maximum;
}

function costShape(value: unknown): ScryptCost | null {
	if (value === null) return null;
	const { n, r, p } = value as Partial<ScryptCost>;
	if (!integerInRange(n, MIN_COST, MAX_COST)) return null;
	if (!integerInRange(r, 1, MAX_R)) return null;
	if (!integerInRange(p, 1, MAX_P)) return null;
	return { n, r, p };
}

function costFitsResources(cost: ScryptCost): boolean {
	const { n, r, p } = cost;
	const memory = 128 * n * r;
	const work = n * r * p;
	// `costShape` already bounds each integer; neither product can overflow a safe integer.
	return memory < MAX_MEMORY && work <= MAX_WORK;
}

function saneCost(value: unknown): value is ScryptCost {
	const cost = costShape(value);
	if (!cost) return false;
	if ((cost.n & (cost.n - 1)) !== 0) return false;
	return costFitsResources(cost);
}

function parseInteger(value: string): number | null {
	if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function decodeCanonicalBase64(value: string, expectedBytes: number): Buffer | null {
	// `Buffer.from` accepts non-canonical spellings; a stored credential must have exactly one form.
	const decoded = Buffer.from(value, 'base64');
	if (decoded.length !== expectedBytes || decoded.toString('base64') !== value) return null;
	return decoded;
}

function parseCost(parts: [string, string, string, string, string, string]): ScryptCost | null {
	const n = parseInteger(parts[1]);
	const r = parseInteger(parts[2]);
	const p = parseInteger(parts[3]);
	const cost = { n, r, p };
	return saneCost(cost) ? cost : null;
}

function parseHash(stored: unknown): { cost: ScryptCost; salt: Buffer; key: Buffer } | null {
	const candidate = typeof stored === 'string' ? stored : '';
	const match = SERIALIZED_HASH.exec(candidate);
	if (!match) return null;
	const fields = match as unknown as [string, string, string, string, string, string];
	const cost = parseCost(fields);
	if (!cost) return null;
	const salt = decodeCanonicalBase64(fields[4], SALT_BYTES);
	if (!salt) return null;
	const key = decodeCanonicalBase64(fields[5], KEY_BYTES);
	return key ? { cost, salt, key } : null;
}

export type PasswordVerificationWork = {
	verifyStored: boolean;
	deriveTarget: boolean;
	upgradeStored: boolean;
	derivations: 1 | 2;
};

const PAD_ONLY_WORK: PasswordVerificationWork = {
	verifyStored: false,
	deriveTarget: true,
	upgradeStored: false,
	derivations: 1
};

function verificationWork(stored: string | null, target: ScryptCost): PasswordVerificationWork {
	const parsed = parseHash(stored);
	if (!parsed) return PAD_ONLY_WORK;
	const current = parsed.cost;
	if (current.n === target.n && current.r === target.r && current.p === target.p) {
		return { verifyStored: true, deriveTarget: false, upgradeStored: false, derivations: 1 };
	}
	// Policy ratchets upward: every parameter must be no greater than the target,
	// so an upgrade attempt spends at most two target derivations. A hash above the
	// target on any axis is stronger or incomparable and is rejected without deriving.
	if (current.n <= target.n && current.r <= target.r && current.p <= target.p) {
		return { verifyStored: true, deriveTarget: true, upgradeStored: true, derivations: 2 };
	}
	return PAD_ONLY_WORK;
}

/** The bounded KDF work an authentication attempt must perform. */
export function passwordVerificationWork(
	stored: string | null,
	target = OWASP_SCRYPT
): PasswordVerificationWork {
	if (!saneCost(target)) throw new RangeError('scrypt cost is outside the supported bounds');
	return verificationWork(stored, target);
}

export type PasswordVerificationResult = {
	verified: boolean;
	/** A target-policy hash of the submitted password, ready for a CAS update. */
	upgradeHash: string | null;
};

/**
 * Verify a stored password while padding an older hash to current-policy work.
 * Independent derivations run together, so the elapsed work approaches the
 * stronger target rather than adding attacker-controlled serial multipliers.
 */
export async function verifyPasswordAtPolicy(
	password: string,
	stored: string | null,
	target = OWASP_SCRYPT
): Promise<PasswordVerificationResult> {
	const work = passwordVerificationWork(stored, target);
	const verification = work.verifyStored
		? verifyPassword(password, stored as string)
		: Promise.resolve(false);
	// A valid submitted password produces the candidate authentication can persist
	// after legacy verification; invalid input still gets the timing work, but is never persisted.
	const canUpgrade = work.upgradeStored && passwordProblem(password) === null;
	const targetPassword = canUpgrade ? password : UNKNOWN_USERNAME_PASSWORD;
	const targetDerivation = work.deriveTarget
		? hashPassword(targetPassword, target)
		: Promise.resolve(null);
	const [verified, targetHash] = await Promise.all([verification, targetDerivation]);
	return {
		verified,
		upgradeHash: verified && canUpgrade ? targetHash : null
	};
}

/** Whether `password` produced `stored`. False for any hash this function cannot read. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	if (!isBoundedPassword(password)) return false;
	const parsed = parseHash(stored);
	if (!parsed) return false;
	return derive(password, parsed.salt, parsed.cost).then(
		(actual) => timingSafeEqual(actual, parsed.key),
		// A malformed stored value must never turn into an authentication outage.
		() => false
	);
}
