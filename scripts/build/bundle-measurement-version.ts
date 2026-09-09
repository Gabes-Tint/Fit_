import { readBuildVersion } from './app-version.ts';
import type { BuildVersion } from './app-version.ts';

/**
 * `readBuildVersion()` derives the version string a build carries from
 * `git describe`, and its length is not stable: a tagged `main` gets
 * `v0.0.NN`, a branch some distance from its tag gets the longer
 * `v0.0.NN+<7-hex>`, and a shallow or differently-fetched checkout can see a
 * different tag distance again. `vite.config.ts` bakes that string into the
 * client bundle as `__APP_VERSION__`/`__APP_COMMIT__`, so its length change
 * alone moves the measured bundle byte count — nothing in the source has to
 * change. That is why `check:bundle` used to report a different number
 * locally than in CI for the exact same tree.
 *
 * Setting this environment variable makes the build embed a fixed-length
 * placeholder instead, so a measurement build's byte count depends only on
 * the code. The deploy build (`bun run build` without this variable set)
 * never sets it and keeps embedding the real, git-derived version — end
 * users and `/api/version` are unaffected.
 */
export const BUNDLE_MEASUREMENT_ENV = 'FIT_BUNDLE_MEASURE_VERSION';

/**
 * A fixed-length stand-in for a real build version. Shaped like a real one
 * (`v<major>.<minor>.<patch>+<7-hex>`) so nothing downstream that inspects
 * the string's shape breaks, but every measurement build embeds exactly this
 * value regardless of which commit, tag distance, or checkout produced it.
 */
export const MEASUREMENT_VERSION: BuildVersion = {
	version: 'v0.0.0+0000000',
	commit: '0000000'
};

/**
 * What `vite.config.ts` embeds as `__APP_VERSION__`/`__APP_COMMIT__`: the
 * fixed placeholder when `env[BUNDLE_MEASUREMENT_ENV]` is set, otherwise
 * whatever `versionProvider` (the real `readBuildVersion` by default) says.
 * `versionProvider` is injectable so a test can prove the placeholder wins
 * regardless of what the underlying version would have been, without needing
 * to control this checkout's actual git state.
 */
export function resolveBuildVersion(
	env: NodeJS.ProcessEnv = process.env,
	versionProvider: () => BuildVersion = readBuildVersion
): BuildVersion {
	return env[BUNDLE_MEASUREMENT_ENV] ? MEASUREMENT_VERSION : versionProvider();
}
