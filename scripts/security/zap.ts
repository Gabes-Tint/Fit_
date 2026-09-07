import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { containerImages } from './config';
import {
	assertDocker,
	capture,
	projectRoot,
	readJsonFile,
	resetReportDirectory,
	run
} from './shared';

interface ZapAlert {
	alert: string;
	alertRef: string;
	confidence: string;
	risk: string;
	riskcode?: string;
	url: string;
}

interface ZapAlertsResponse {
	alerts: ZapAlert[];
}

interface ZapPolicy {
	failAtOrAboveRiskCode: number;
	ignoredAlertReferences: string[];
}

const proxyPort = process.env.ZAP_PROXY_PORT ?? '8090';
if (!/^\d+$/.test(proxyPort)) throw new Error('ZAP_PROXY_PORT must be numeric.');

const proxyUrl = `http://127.0.0.1:${proxyPort}`;
// Tracks the port Playwright binds the preview to, so each tree scans its own app.
const previewPort = process.env.FIT_PREVIEW_PORT ?? '4173';
if (!/^\d+$/.test(previewPort)) throw new Error('FIT_PREVIEW_PORT must be numeric.');
const targetUrl = `http://host.docker.internal:${previewPort}`;
const containerName = `fit-zap-${process.pid}`;
const apiHeaders = { Host: 'zap' } as const;
const policy = await readJsonFile<ZapPolicy>(path.join(projectRoot, 'security', 'zap-policy.json'));
const reportDirectory = await resetReportDirectory('zap');
const riskCodes = new Map([
	['Informational', 0],
	['Low', 1],
	['Medium', 2],
	['High', 3]
]);

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function zapJson<T>(pathName: string): Promise<T> {
	const response = await fetch(`${proxyUrl}${pathName}`, { headers: apiHeaders });
	if (!response.ok) throw new Error(`ZAP API returned HTTP ${response.status} for ${pathName}.`);
	return (await response.json()) as T;
}

async function waitForZap(): Promise<void> {
	for (let attempt = 0; attempt < 90; attempt += 1) {
		try {
			await zapJson('/JSON/core/view/version/');
			return;
		} catch {
			await wait(1_000);
		}
	}
	throw new Error('ZAP did not become ready within 90 seconds.');
}

async function waitForPassiveScan(): Promise<void> {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		const response = await zapJson<{ recordsToScan: string }>('/JSON/pscan/view/recordsToScan/');
		if (Number(response.recordsToScan) === 0) return;
		await wait(1_000);
	}
	throw new Error('ZAP passive scanning did not finish within 120 seconds.');
}

async function saveReport(endpoint: string, filename: string): Promise<void> {
	const response = await fetch(`${proxyUrl}${endpoint}`, { headers: apiHeaders });
	if (!response.ok) throw new Error(`Could not create ${filename}: HTTP ${response.status}.`);
	await writeFile(
		path.join(reportDirectory, filename),
		new Uint8Array(await response.arrayBuffer())
	);
}

function riskCode(alert: ZapAlert): number {
	if (alert.riskcode !== undefined && /^\d+$/.test(alert.riskcode)) {
		return Number(alert.riskcode);
	}

	const code = riskCodes.get(alert.risk);
	if (code === undefined) throw new Error(`Unknown ZAP risk level: ${alert.risk}.`);
	return code;
}

await assertDocker();

try {
	await run('docker', [
		'run',
		'--detach',
		'--rm',
		'--name',
		containerName,
		'--add-host=host.docker.internal:host-gateway',
		'--publish',
		`127.0.0.1:${proxyPort}:8080`,
		'--cap-drop=ALL',
		'--security-opt=no-new-privileges',
		'--memory=1g',
		'--cpus=2',
		containerImages.zap,
		'zap.sh',
		'-daemon',
		'-silent',
		'-host',
		'0.0.0.0',
		'-port',
		'8080',
		'-config',
		'api.disablekey=true',
		'-config',
		'api.addrs.addr.name=.*',
		'-config',
		'api.addrs.addr.regex=true'
	]);

	try {
		await waitForZap();
	} catch (error) {
		console.error(await capture('docker', ['logs', containerName]));
		throw error;
	}

	const playwrightExitCode = await run(
		'bun',
		['run', 'test:e2e', '--', '--project=mobile-chrome'],
		{
			allowFailure: true,
			env: {
				...process.env,
				CI: '1',
				E2E_BASE_URL: targetUrl,
				ZAP_PROXY_URL: proxyUrl
			}
		}
	);

	await waitForPassiveScan();
	await Promise.all([
		saveReport('/OTHER/core/other/htmlreport/', 'zap.html'),
		saveReport('/OTHER/core/other/jsonreport/', 'zap.json')
	]);

	const { alerts } = await zapJson<ZapAlertsResponse>(
		`/JSON/core/view/alerts/?baseurl=${encodeURIComponent(targetUrl)}&start=0&count=10000`
	);
	await writeFile(
		path.join(reportDirectory, 'alerts.json'),
		`${JSON.stringify({ alerts }, null, 2)}\n`
	);

	const ignoredAlerts = new Set(policy.ignoredAlertReferences);
	const blockingAlerts = alerts.filter(
		(alert) => riskCode(alert) >= policy.failAtOrAboveRiskCode && !ignoredAlerts.has(alert.alertRef)
	);
	const uniqueAlerts = new Set(alerts.map((alert) => `${alert.alertRef}:${alert.url}`));

	console.log(
		`ZAP findings: ${uniqueAlerts.size} unique alert/URL pairs, ${blockingAlerts.length} blocking. Reports: ${path.relative(projectRoot, reportDirectory)}`
	);

	if (playwrightExitCode !== 0 || blockingAlerts.length > 0) process.exitCode = 1;
} finally {
	await run('docker', ['rm', '--force', containerName], { allowFailure: true });
}
