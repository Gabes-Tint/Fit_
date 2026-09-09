import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureStatus } from '../security/shared';
import { collectAssets, measure } from './bundle-assets';
import { BUNDLE_MEASUREMENT_ENV } from '../build/bundle-measurement-version';

/**
 * The regression this proves: `check:bundle`'s reported byte counts must not
 * depend on how long the real `git describe`/`rev-parse` output is — that
 * length varies between checkouts (a shallow clone, a different tag
 * distance, a branch ahead of its tag by a different number of characters)
 * and used to move the measured bundle size even when no source changed.
 *
 * A fake `git` on `PATH` stands in for the real one and answers with two
 * describe strings of very different lengths across two full production
 * builds, both with `BUNDLE_MEASUREMENT_ENV` set the way `check:bundle` sets
 * it. If a future change ever let the real, variable-length version string
 * leak back into a measurement build, this fake `git` would make that show
 * up as a byte-count difference here; today it must not, because
 * `resolveBuildVersion` never even asks its version provider when measuring.
 *
 * This runs two real `bun run build`s, so it is slow (tens of seconds); that
 * cost buys the only proof that actually exercises the build pipeline rather
 * than the pure `resolveBuildVersion` unit already covered in
 * `bundle-measurement-version.spec.ts`.
 */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

const FAKE_GIT = `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "rev-parse" ] && [ "$2" = "--short" ] && [ "$3" = "HEAD" ]; then
	echo "$FAKE_GIT_SHORT_SHA"
	exit 0
fi
if [ "$1" = "describe" ]; then
	echo "$FAKE_GIT_DESCRIBE"
	exit 0
fi
exec /usr/bin/git "$@"
`;

async function buildWithFakeVersion(binDirectory: string, describe: string, sha: string) {
	const { exitCode, output } = await captureStatus('bun', ['run', 'build'], {
		cwd: projectRoot,
		env: {
			...process.env,
			PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
			[BUNDLE_MEASUREMENT_ENV]: '1',
			FAKE_GIT_DESCRIBE: describe,
			FAKE_GIT_SHORT_SHA: sha
		}
	});
	if (exitCode !== 0) throw new Error(`Measurement build failed (exit ${exitCode}):\n${output}`);
	const assetRoot = path.join(projectRoot, '.svelte-kit', 'output', 'client', '_app', 'immutable');
	return measure(await collectAssets(assetRoot, assetRoot));
}

describe('bundle measurement is independent of the git-derived version string length', () => {
	it('reports identical byte counts for a short and a very long fake version', async () => {
		const binDirectory = await mkdtemp(path.join(tmpdir(), 'fit-fake-git-'));
		try {
			const gitPath = path.join(binDirectory, 'git');
			await writeFile(gitPath, FAKE_GIT);
			await chmod(gitPath, 0o755);

			const short = await buildWithFakeVersion(binDirectory, 'v1', 'a');
			const long = await buildWithFakeVersion(
				binDirectory,
				'v1.2.3-beta.999+abcdef1234567890',
				'abcdef1234567890'
			);

			// SvelteKit stamps a random `__sveltekit_<token>` identifier into one
			// chunk on every build (six or seven characters, four occurrences), an
			// unrelated four bytes of noise `docs/bundle-audit.md` documents and
			// this test tolerates. What it must not tolerate is anything close to
			// the eight-byte-or-more delta the variable-length version string used
			// to cause.
			expect(Math.abs(long.javascriptBytes - short.javascriptBytes)).toBeLessThanOrEqual(4);
			expect(long.cssBytes).toBe(short.cssBytes);
			expect(Math.abs(long.largestAsset.bytes - short.largestAsset.bytes)).toBeLessThanOrEqual(4);
		} finally {
			await rm(binDirectory, { recursive: true, force: true });
		}
	}, 180_000);
});
