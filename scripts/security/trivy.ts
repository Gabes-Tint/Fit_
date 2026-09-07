import path from 'node:path';
import { containerImages } from './config';
import {
	assertDocker,
	cacheRoot,
	ensureDirectory,
	hostUser,
	projectRoot,
	readJsonFile,
	resetReportDirectory,
	run
} from './shared';

interface Finding {
	Severity?: string;
}

interface TrivyResult {
	Misconfigurations?: Finding[];
	Vulnerabilities?: Finding[];
}

interface TrivyReport {
	Results?: TrivyResult[];
}

await assertDocker();
const reportDirectory = await resetReportDirectory('trivy');
const cacheDirectory = path.join(cacheRoot, 'trivy');
await ensureDirectory(cacheDirectory);
const reportPath = path.join(reportDirectory, 'trivy.json');

await run('docker', [
	'run',
	'--rm',
	'--cap-drop=ALL',
	'--security-opt=no-new-privileges',
	'--user',
	hostUser(),
	'--env',
	'HOME=/tmp',
	'--volume',
	`${projectRoot}:/workspace:ro`,
	'--volume',
	`${reportDirectory}:/reports:rw`,
	'--volume',
	`${cacheDirectory}:/cache:rw`,
	containerImages.trivy,
	'fs',
	'--cache-dir=/cache',
	'--scanners=vuln,misconfig',
	// Trivy's default misconfig set targets IaC this repo does not contain; narrow
	// to `dockerfile` so a clean result means something was checked. Widen this
	// when a new kind of infrastructure file lands.
	'--misconfig-scanners=dockerfile',
	'--include-dev-deps',
	'--severity=UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL',
	'--format=json',
	'--output=/reports/trivy.json',
	'--skip-dirs=/workspace/node_modules',
	'--skip-dirs=/workspace/.svelte-kit',
	'--skip-dirs=/workspace/build',
	'--skip-dirs=/workspace/coverage',
	'--skip-dirs=/workspace/playwright-report',
	'--skip-dirs=/workspace/reports',
	'--skip-dirs=/workspace/.security-cache',
	'/workspace'
]);

const report = await readJsonFile<TrivyReport>(reportPath);
const findings = (report.Results ?? []).flatMap((result) => [
	...(result.Vulnerabilities ?? []),
	...(result.Misconfigurations ?? [])
]);
const blockingFindings = findings.filter(
	({ Severity }) => Severity === 'HIGH' || Severity === 'CRITICAL'
);

console.log(
	`Trivy findings: ${findings.length} total, ${blockingFindings.length} High/Critical. Report: ${path.relative(projectRoot, reportPath)}`
);

if (blockingFindings.length > 0) process.exitCode = 1;
