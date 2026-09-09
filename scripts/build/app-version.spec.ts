import { describe, expect, it } from 'vitest';
import { deriveAppVersion, UNKNOWN_COMMIT } from './app-version';

/**
 * The derivation with its git answers injected, never shelled out to: a spec
 * that ran `git describe` would assert whatever the checkout it happened to run
 * in said, which is a different answer on a tag, on a branch and in CI.
 */

const PACKAGE_VERSION = '0.0.1';

describe('the version a build carries', () => {
	it('is the tag itself when HEAD is exactly on it', () => {
		expect(
			deriveAppVersion({
				tag: 'v0.0.7',
				tagged: true,
				commit: 'be031ca',
				packageVersion: PACKAGE_VERSION
			})
		).toBe('v0.0.7');
	});

	it('names the commit as well when HEAD is ahead of the tag', () => {
		expect(
			deriveAppVersion({
				tag: 'v0.0.7',
				tagged: false,
				commit: 'be031ca',
				packageVersion: PACKAGE_VERSION
			})
		).toBe('v0.0.7+be031ca');
	});

	it('will not let an untagged build claim a release number', () => {
		// `tagged` without a tag is a caller mixing two git answers up. The
		// suffix is what stops the result reading as a real release.
		expect(
			deriveAppVersion({
				tag: null,
				tagged: true,
				commit: 'be031ca',
				packageVersion: PACKAGE_VERSION
			})
		).toBe('v0.0.1+be031ca');
	});

	it('says the commit is unknown when there is no git to ask, as in an unpacked tarball', () => {
		expect(
			deriveAppVersion({ tag: null, tagged: false, commit: null, packageVersion: PACKAGE_VERSION })
		).toBe(`v0.0.1+${UNKNOWN_COMMIT}`);
	});

	it('still names the tag it was built from when git can offer no commit', () => {
		expect(
			deriveAppVersion({
				tag: 'v0.0.7',
				tagged: false,
				commit: null,
				packageVersion: PACKAGE_VERSION
			})
		).toBe(`v0.0.7+${UNKNOWN_COMMIT}`);
	});

	it('reads the package version rather than assuming one', () => {
		expect(
			deriveAppVersion({ tag: null, tagged: false, commit: 'be031ca', packageVersion: '1.2.3' })
		).toBe('v1.2.3+be031ca');
	});
});
