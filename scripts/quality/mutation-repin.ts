import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { mutantFingerprint, sourceWindowHash } from './mutation-verdict';

/**
 * Computes the `sourceHash`/`fingerprint` pair for one equivalence-ledger
 * entry, so re-pinning an entry after its code moved never means hand-hashing
 * a location object again.
 *
 * Usage:
 *   bun run mutation:repin <file> <mutatorName> <replacement> \
 *     --start-line N --start-column N --end-line N --end-column N
 *
 * `file` is the path as it appears in the ledger (relative to the repo root).
 * The location's key order does not matter — the hash canonicalizes it —
 * but every field must match the mutant Stryker currently reports exactly:
 * same mutator, same replacement text, same start/end position.
 */

function flag(argv: string[], name: string): number {
	const index = argv.indexOf(`--${name}`);
	if (index === -1 || argv[index + 1] === undefined) {
		throw new Error(`Missing --${name} <value>.`);
	}
	const value = Number(argv[index + 1]);
	if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer.`);
	return value;
}

const [file, mutatorName, replacement, ...rest] = process.argv.slice(2);
if (file === undefined || mutatorName === undefined || replacement === undefined) {
	throw new Error(
		'Usage: mutation-repin.ts <file> <mutatorName> <replacement> --start-line N --start-column N --end-line N --end-column N'
	);
}

const location = {
	start: { line: flag(rest, 'start-line'), column: flag(rest, 'start-column') },
	end: { line: flag(rest, 'end-line'), column: flag(rest, 'end-column') }
};

const projectRoot = new URL('../../', import.meta.url);
const source = await readFile(path.join(projectRoot.pathname, file), 'utf8');
const sourceHash = sourceWindowHash(source, location);
const fingerprint = mutantFingerprint({ file, mutatorName, replacement, sourceHash });

console.log(
	JSON.stringify({ file, mutatorName, replacement, location, sourceHash, fingerprint }, null, '\t')
);
