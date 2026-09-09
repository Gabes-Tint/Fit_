import { describe, expect, it } from 'vitest';
import {
	BUNDLE_MEASUREMENT_ENV,
	MEASUREMENT_VERSION,
	resolveBuildVersion
} from './bundle-measurement-version';
import type { BuildVersion } from './app-version';

const shortVersion: BuildVersion = { version: 'v1', commit: 'a' };
const longVersion: BuildVersion = {
	version: 'v1.2.3-beta.999+abcdef1234567890',
	commit: 'abcdef1234567890'
};

describe('resolveBuildVersion', () => {
	it('passes through the version provider when the measurement env var is unset', () => {
		expect(resolveBuildVersion({}, () => shortVersion)).toEqual(shortVersion);
		expect(resolveBuildVersion({}, () => longVersion)).toEqual(longVersion);
	});

	it('ignores the version provider and returns the fixed placeholder when set', () => {
		const env = { [BUNDLE_MEASUREMENT_ENV]: '1' };
		expect(resolveBuildVersion(env, () => shortVersion)).toEqual(MEASUREMENT_VERSION);
		expect(resolveBuildVersion(env, () => longVersion)).toEqual(MEASUREMENT_VERSION);
	});

	it('reports the identical value regardless of the underlying version length, when measuring', () => {
		const env = { [BUNDLE_MEASUREMENT_ENV]: '1' };
		const fromShort = resolveBuildVersion(env, () => shortVersion);
		const fromLong = resolveBuildVersion(env, () => longVersion);
		expect(fromShort).toEqual(fromLong);
	});

	it('treats an empty string env value as unset', () => {
		expect(resolveBuildVersion({ [BUNDLE_MEASUREMENT_ENV]: '' }, () => shortVersion)).toEqual(
			shortVersion
		);
	});
});
