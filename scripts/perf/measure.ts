import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { measureBundle } from './bundle.ts';
import { medianRouteMetrics } from './phone-paint-metrics.ts';
import type { PhonePaintReport, RouteSample } from './phone-paint-metrics.ts';
import { measureServerLatency } from './server-latency.ts';
import { formatPlans, planStatements } from './sql-plans.ts';
import { catalogHint, formatReport } from './report.ts';
import type { PerfReport } from './report.ts';
import { compareReports, formatCompare } from './compare.ts';
import { formatCommitted } from './prettier-format.ts';
import { catalogPath } from '../../src/lib/server/catalog/connection.ts';
import { readJsonFile } from '../security/shared';

/**
 * The one command issue #130 asks for: runs instruments 1 to 4 and writes
 * `reports/perf/latest.json` and `reports/perf/latest.md`. `--baseline` also
 * writes `quality/perf-baseline.json` and `quality/perf-plans.md`, the
 * committed numbers a later run can be checked against; `--compare` prints
 * the current run against that stored baseline.
 *
 * Every instrument that touches `node:sqlite` runs under plain Node, the way
 * `search:eval` already does — Bun has no `node:sqlite` binding, so this
 * script is invoked as `node scripts/perf/measure.ts`, not `bun run`.
 */
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportDirectory = path.join(projectRoot, 'reports', 'perf');
const qualityDirectory = path.join(projectRoot, 'quality');
const phonePaintRawPath = path.join(reportDirectory, 'phone-paint.raw.json');

interface Options {
	baseline: boolean;
	compare: boolean;
}

function parseArguments(argv: string[]): Options {
	return { baseline: argv.includes('--baseline'), compare: argv.includes('--compare') };
}

/** Runs instrument 2's Playwright script and reads back what it wrote. */
async function measurePhonePaint(): Promise<PhonePaintReport> {
	const result = spawnSync(
		'bunx',
		['playwright', 'test', '--config', 'scripts/perf/phone-paint.config.ts'],
		{ cwd: projectRoot, stdio: 'inherit' }
	);
	if (result.status !== 0) {
		throw new Error(`Phone-profile paint run failed (exit ${String(result.status)}).`);
	}
	interface PhonePaintRaw {
		routeSamples: Record<string, RouteSample[]>;
		logSheetSamples: number[];
		catalogSearchMs: number | null;
		catalogSearchSkipReason: string | null;
	}
	const raw = await readJsonFile<PhonePaintRaw>(phonePaintRawPath);
	const routes = Object.entries(raw.routeSamples).map(([route, samples]) =>
		medianRouteMetrics(route, samples)
	);
	const sorted = [...raw.logSheetSamples].sort((left, right) => left - right);
	const mid = Math.floor(sorted.length / 2);
	const logSheetOpenMs =
		sorted.length === 0
			? null
			: sorted.length % 2 === 0
				? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
				: (sorted[mid] ?? 0);
	return {
		routes,
		logSheetOpenMs,
		catalogSearchMs: raw.catalogSearchMs,
		catalogSearchSkipReason: raw.catalogSearchSkipReason
	};
}

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	await mkdir(reportDirectory, { recursive: true });

	console.log('Instrument 1/4: bundle...');
	const bundle = await measureBundle(projectRoot);

	console.log('Instrument 2/4: phone-profile paint...');
	const phonePaint = await measurePhonePaint();

	console.log('Instrument 3/4: server latency...');
	const serverLatency = await measureServerLatency(projectRoot, catalogPath);

	console.log('Instrument 4/4: SQLite plans...');
	const plans = await planStatements(projectRoot);
	const plansMarkdown = formatPlans(plans);
	await writeFile(path.join(reportDirectory, 'plans.md'), plansMarkdown);

	const report: PerfReport = {
		when: new Date().toISOString(),
		bundle,
		phonePaint,
		serverLatency,
		sqlPlans: {
			catalogSource: plans.catalogSource,
			statementCount: plans.plans.length,
			unresolvedCount: plans.unresolved.length
		}
	};

	await writeFile(
		path.join(reportDirectory, 'latest.json'),
		`${JSON.stringify(report, null, 2)}\n`
	);
	await writeFile(path.join(reportDirectory, 'latest.md'), formatReport(report));

	if (options.baseline) {
		await mkdir(qualityDirectory, { recursive: true });
		const baselinePath = path.join(qualityDirectory, 'perf-baseline.json');
		const plansPath = path.join(qualityDirectory, 'perf-plans.md');
		await writeFile(
			baselinePath,
			await formatCommitted(JSON.stringify(report, null, 2), baselinePath)
		);
		await writeFile(plansPath, await formatCommitted(plansMarkdown, plansPath));
	}

	if (options.compare) {
		const baselinePath = path.join(qualityDirectory, 'perf-baseline.json');
		if (!existsSync(baselinePath)) {
			throw new Error(`No baseline at ${baselinePath}; run --baseline first.`);
		}
		const baseline = await readJsonFile<PerfReport>(baselinePath);
		console.log('');
		console.log(formatCompare(compareReports(baseline, report)));
	}

	console.log('');
	console.log(formatReport(report));
	const hint = catalogHint(report);
	if (hint !== null) console.log(`\n${hint}`);
	console.log(
		`\nWritten to ${path.relative(projectRoot, path.join(reportDirectory, 'latest.md'))}`
	);
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	await main();
}
