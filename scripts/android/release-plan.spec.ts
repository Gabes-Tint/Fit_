import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_ORIGIN } from '../deploy/config';
import { projectRoot } from '../security/shared';
import {
	androidVersion,
	assertJavaVersion,
	connectedDevices,
	APP_ID,
	newestBuildTools,
	parseJavaMajor,
	parseReleaseArguments,
	PRODUCTION_SERVER_URL,
	RELEASE_APK_PATH,
	REQUIRED_JDK_MAJOR,
	resolveAndroidSdk,
	resolveSigningProperties,
	SIGNING_PROPERTIES_VARIABLE,
	VERSION_CODE_MAJOR_STRIDE,
	VERSION_CODE_MINOR_STRIDE
} from './release-plan';

/**
 * The decisions a release build makes before it spends fifteen minutes on
 * Gradle. Each of them is a way to ship an APK that is wrong in a way nobody
 * sees until it is on a phone: pointed at the wrong host, unsigned, or carrying
 * a versionCode that makes a newer build look older than an older one.
 */

const NO_ENVIRONMENT: Record<string, string | undefined> = {};

describe('the version an APK carries', () => {
	it('packs the three tag numbers into one increasing code', () => {
		expect(androidVersion('v0.0.1')).toEqual({ versionName: 'v0.0.1', versionCode: 1 });
		expect(androidVersion('v0.1.0')).toEqual({ versionName: 'v0.1.0', versionCode: 1_000 });
		expect(androidVersion('v1.0.0')).toEqual({ versionName: 'v1.0.0', versionCode: 1_000_000 });
	});

	it('orders v0.0.10 above v0.0.9, which the string never did', () => {
		expect(androidVersion('v0.0.10').versionCode).toBeGreaterThan(
			androidVersion('v0.0.9').versionCode
		);
	});

	it('keeps the whole tag as the name, so a build ahead of its tag says so', () => {
		expect(androidVersion('v0.0.7+be031ca')).toEqual({
			versionName: 'v0.0.7+be031ca',
			versionCode: 7
		});
	});

	it('uses the strides the packing documents', () => {
		expect(androidVersion('v0.2.3').versionCode).toBe(2 * VERSION_CODE_MINOR_STRIDE + 3);
		expect(androidVersion('v4.0.0').versionCode).toBe(4 * VERSION_CODE_MAJOR_STRIDE);
	});

	it('reads a major of more than one digit, which a single-digit pattern would truncate', () => {
		expect(androidVersion('v12.0.0').versionCode).toBe(12 * VERSION_CODE_MAJOR_STRIDE);
		expect(androidVersion('v0.12.34').versionCode).toBe(12 * VERSION_CODE_MINOR_STRIDE + 34);
	});

	it('requires the tag to start the string, not merely to appear in it', () => {
		expect(() => androidVersion('xv1.0.0')).toThrow(/Cannot derive an Android version/);
		expect(() => androidVersion('v1.0.0 ')).toThrow(/Cannot derive an Android version/);
	});

	it('refuses a minor or patch that would collide with the component above it', () => {
		expect(() => androidVersion('v0.0.1000')).toThrow(/patch of 1000/);
		expect(() => androidVersion('v0.1000.0')).toThrow(/minor of 1000/);
	});

	it('refuses a string that is not a version tag rather than guessing at one', () => {
		for (const input of ['0.0.1', 'v0.0', 'v0.0.1-rc1', 'unknown', '']) {
			expect(() => androidVersion(input)).toThrow(/Cannot derive an Android version/);
		}
	});
});

describe('the arguments a release build accepts', () => {
	it('points at production when told nothing', () => {
		expect(parseReleaseArguments([])).toEqual({
			serverUrl: PRODUCTION_SERVER_URL,
			unsigned: false
		});
	});

	it('takes another https origin, for a build aimed somewhere else', () => {
		expect(parseReleaseArguments(['--server-url=https://staging.example.com']).serverUrl).toBe(
			'https://staging.example.com'
		);
	});

	it('refuses a cleartext or loopback origin, which no phone off this cable can reach', () => {
		expect(() => parseReleaseArguments(['--server-url=http://localhost:5175'])).toThrow(
			/must be an https:\/\/ origin/
		);
		expect(() => parseReleaseArguments(['--server-url=fit.psilva.org'])).toThrow(
			/must be an https:\/\/ origin/
		);
	});

	it('records --unsigned rather than ignoring it', () => {
		expect(parseReleaseArguments(['--unsigned']).unsigned).toBe(true);
	});

	it('stops on an argument it does not know, so a typo cannot silently keep the default', () => {
		expect(() => parseReleaseArguments(['--server-url', 'https://example.com'])).toThrow(
			/Unexpected argument --server-url/
		);
		expect(() => parseReleaseArguments(['--release'])).toThrow(/Unexpected argument --release/);
	});
});

describe('whether the build will be signed', () => {
	it('uses the properties file the environment names', () => {
		expect(
			resolveSigningProperties(
				{ serverUrl: PRODUCTION_SERVER_URL, unsigned: false },
				{ [SIGNING_PROPERTIES_VARIABLE]: ' /home/someone/keys/fit.properties ' }
			)
		).toBe('/home/someone/keys/fit.properties');
	});

	it('stops before the build when nothing names one, because an unsigned APK cannot install', () => {
		for (const environment of [NO_ENVIRONMENT, { [SIGNING_PROPERTIES_VARIABLE]: '   ' }]) {
			expect(() =>
				resolveSigningProperties({ serverUrl: PRODUCTION_SERVER_URL, unsigned: false }, environment)
			).toThrow(new RegExp(`${SIGNING_PROPERTIES_VARIABLE} is not set`));
		}
	});

	it('is unsigned only when asked, and then ignores what the environment says', () => {
		expect(
			resolveSigningProperties(
				{ serverUrl: PRODUCTION_SERVER_URL, unsigned: true },
				{ [SIGNING_PROPERTIES_VARIABLE]: '/home/someone/keys/fit.properties' }
			)
		).toBeNull();
		expect(
			resolveSigningProperties({ serverUrl: PRODUCTION_SERVER_URL, unsigned: true }, NO_ENVIRONMENT)
		).toBeNull();
	});
});

describe('finding the Android SDK', () => {
	it('prefers ANDROID_HOME, which is what another machine will set', () => {
		expect(resolveAndroidSdk({ ANDROID_HOME: '/opt/sdk' }, 'sdk.dir=/ignored')).toBe('/opt/sdk');
	});

	it('accepts ANDROID_SDK_ROOT when ANDROID_HOME is absent or empty', () => {
		expect(resolveAndroidSdk({ ANDROID_HOME: '  ', ANDROID_SDK_ROOT: '/opt/sdk' }, null)).toBe(
			'/opt/sdk'
		);
	});

	it('falls back to sdk.dir in local.properties, which Android Studio writes', () => {
		expect(
			resolveAndroidSdk(NO_ENVIRONMENT, '## comment\nsdk.dir=/home/someone/Android/Sdk\n')
		).toBe('/home/someone/Android/Sdk');
	});

	it('reads sdk.dir as a whole key, not as the tail of another one', () => {
		expect(() => resolveAndroidSdk(NO_ENVIRONMENT, 'not.sdk.dir=/wrong\n')).toThrow(
			/No Android SDK/
		);
	});

	it('trims the value and keeps any = inside the path', () => {
		expect(resolveAndroidSdk(NO_ENVIRONMENT, ' sdk.dir = /opt/sdk=1 \n')).toBe('/opt/sdk=1');
	});

	it('ignores an sdk.dir with nothing after it', () => {
		expect(() => resolveAndroidSdk(NO_ENVIRONMENT, 'sdk.dir=\nsdk.dir=   \n')).toThrow(
			/No Android SDK/
		);
	});

	it('says what to do rather than letting Gradle fail on its own', () => {
		expect(() => resolveAndroidSdk(NO_ENVIRONMENT, null)).toThrow(/No Android SDK/);
		expect(() => resolveAndroidSdk(NO_ENVIRONMENT, 'ndk.dir=/opt/ndk\n')).toThrow(/No Android SDK/);
	});
});

describe('the JDK the build runs under', () => {
	const JDK_21 = [
		'openjdk version "21.0.12.1" 2026-08-18',
		'OpenJDK Runtime Environment (build 21.0.12.1+1)'
	].join('\n');

	it('reads the major out of what java prints', () => {
		expect(parseJavaMajor(JDK_21)).toBe(REQUIRED_JDK_MAJOR);
		expect(parseJavaMajor('openjdk version "17" 2021-09-14')).toBe(17);
		expect(parseJavaMajor('java version "1.8.0_401"')).toBe(1);
	});

	it('answers nothing when the output is not a version at all', () => {
		expect(parseJavaMajor('java: command not found')).toBeNull();
	});

	it('passes 21 and refuses anything else by name', () => {
		expect(() => assertJavaVersion(JDK_21)).not.toThrow();
		expect(() => assertJavaVersion('openjdk version "25.0.1" 2026-01-01')).toThrow(/reports 25/);
		expect(() => assertJavaVersion('nothing here')).toThrow(/nothing recognizable/);
	});
});

describe('which devices adb is offering', () => {
	it('lists only the ones that are ready', () => {
		expect(
			connectedDevices(
				[
					'List of devices attached',
					'R58M30ABCDE\tdevice product:x model:y',
					'emulator-5554\toffline',
					'R58M3012345\tunauthorized',
					''
				].join('\n')
			)
		).toEqual(['R58M30ABCDE']);
	});

	it('is empty when nothing is attached, header line and all', () => {
		expect(connectedDevices('List of devices attached\n\n')).toEqual([]);
	});

	it('reads a line however adb spaced it, and however it is indented', () => {
		expect(connectedDevices('List of devices attached\n  R58M30ABCDE   device\n')).toEqual([
			'R58M30ABCDE'
		]);
	});

	it('does not take a serial off a line whose state is merely a prefix of device', () => {
		expect(connectedDevices('List of devices attached\nR58M30ABCDE\tdevices\n')).toEqual([]);
	});
});

describe('finding apksigner in the SDK', () => {
	it('takes the newest build-tools by number, not by text', () => {
		expect(newestBuildTools(['35.0.0', '36.0.0', '9.0.0'])).toBe('36.0.0');
		expect(newestBuildTools(['36.0.0', '36.1.0'])).toBe('36.1.0');
		expect(newestBuildTools(['36.0.1', '36.0.0'])).toBe('36.0.1');
	});

	it('ignores directories that are not a three-part version', () => {
		expect(newestBuildTools(['debug', '34.0.0', '35.0.0-rc1'])).toBe('34.0.0');
	});

	it('answers nothing when the SDK has no build tools at all', () => {
		expect(newestBuildTools([])).toBeNull();
		expect(newestBuildTools(['source.properties'])).toBeNull();
	});

	it('reads a two-digit minor or patch, which a single-digit pattern would not match at all', () => {
		expect(newestBuildTools(['36.9.0', '36.10.0'])).toBe('36.10.0');
		expect(newestBuildTools(['36.0.9', '36.0.10'])).toBe('36.0.10');
	});

	it('requires the whole directory name to be the version, not merely to end with one', () => {
		expect(newestBuildTools(['preview-36.0.0'])).toBeNull();
	});

	it('holds its answer whichever order the SDK lists them in', () => {
		expect(newestBuildTools(['36.1.0', '36.0.0'])).toBe('36.1.0');
		expect(newestBuildTools(['36.0.1', '36.0.0', '35.9.9'])).toBe('36.0.1');
		expect(newestBuildTools(['36.0.0', '36.0.0'])).toBe('36.0.0');
	});
});

describe('what this module and the rest of the repository have to agree on', () => {
	const read = (file: string): string => readFileSync(path.join(projectRoot, file), 'utf8');

	it('points a release build at the origin the deploy serves', () => {
		expect(PRODUCTION_SERVER_URL).toBe(PUBLIC_ORIGIN);
	});

	it('names the application id the native project builds', () => {
		expect(read('android/app/build.gradle')).toContain(`applicationId "${APP_ID}"`);
	});

	it('names the signing variable android/app/build.gradle actually reads', () => {
		expect(read('android/app/build.gradle')).toContain(
			`System.getenv('${SIGNING_PROPERTIES_VARIABLE}')`
		);
	});

	it('agrees with the APK path the README tells a person to look for', () => {
		expect(RELEASE_APK_PATH).toBe('android/app/build/outputs/apk/release/app-release.apk');
		expect(read('README.md')).toContain(RELEASE_APK_PATH);
	});
});
