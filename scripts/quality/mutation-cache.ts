import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MutationLane } from './mutation-types';
import { readJsonFileOrNull } from '../security/shared';

const COMPATIBILITY_INPUTS = [
	'.tool-versions',
	'bun.lock',
	'package.json',
	'quality/mutation-equivalents.json',
	'quality/mutation-policy.json',
	'scripts/quality/mutation-cache.ts',
	'scripts/quality/mutation-run.ts',
	'scripts/quality/mutation-scope.ts',
	'scripts/quality/mutation-types.ts',
	'scripts/quality/mutation-verdict.ts',
	'stryker.config.mjs',
	'tsconfig.json',
	'vite.config.ts'
];

export async function mutationCompatibilityDigest(
	projectRoot: string,
	lane: MutationLane
): Promise<string> {
	const hash = createHash('sha256');
	hash.update(`fit-mutation-cache-v1\0${lane}\0`);
	for (const file of COMPATIBILITY_INPUTS) {
		hash.update(`${file}\0`);
		hash.update(await readFile(path.join(projectRoot, file)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

export async function prepareMutationCache(options: {
	projectRoot: string;
	lane: MutationLane;
	incrementalPath: string;
	metadataPath: string;
}): Promise<string> {
	const digest = await mutationCompatibilityDigest(options.projectRoot, options.lane);
	// Missing or malformed metadata means the incremental result is not trustworthy.
	const metadata = await readJsonFileOrNull<{ digest?: string }>(options.metadataPath);
	const recorded = metadata?.digest ?? null;
	if (recorded !== digest) await rm(options.incrementalPath, { force: true });
	// Consume the validity marker before Stryker runs, so a cancelled process
	// leaves no metadata to bless a partially rewritten incremental file.
	await rm(options.metadataPath, { force: true });
	return digest;
}

export async function recordMutationCache(metadataPath: string, digest: string): Promise<void> {
	await writeFile(metadataPath, `${JSON.stringify({ version: 1, digest }, null, '\t')}\n`);
}
