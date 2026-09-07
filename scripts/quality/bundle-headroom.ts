import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run, captureStatus, readJsonFile } from '../security/shared';
import { collectAssets, measure } from './bundle-assets';
import type { Asset, Measurement } from './bundle-assets';
import type { BundleBudgets } from './config-types';

export type { Asset, Measurement };
export { measure };

/**
 * Answers one question with one number: how much headroom does the current
 * tree's production build have against the byte budgets in
 * `quality/bundle-budgets.json`, and — with `--against` — how did that
 * change against a ref.
 *
 * This exists because three agents reported three different byte counts for
 * the same `main` in one evening: some read the budget out of a stale
 * `reports/quality/bundle/bundle-budget.json` left over from an old run
 * instead of measuring, and some measured a stale checkout. Budgets always
 * come from `quality/bundle-budgets.json`; the report file is always
 * rewritten from a fresh measurement before this prints anything, so it can
 * no longer be the thing that misleads the next agent.
 */

export interface BudgetRow {
	metric: string;
	bytes: number;
	budget: number;
	headroom: number;
}

/** Pure: one row per metric, headroom negative when the budget is already blown. */
export function buildBudgetTable(measurement: Measurement, budgets: BundleBudgets): BudgetRow[] {
	return [
		{
			metric: 'JS',
			bytes: measurement.javascriptBytes,
			budget: budgets.clientJavaScriptBytes,
			headroom: budgets.clientJavaScriptBytes - measurement.javascriptBytes
		},
		{
			metric: 'CSS',
			bytes: measurement.cssBytes,
			budget: budgets.clientCssBytes,
			headroom: budgets.clientCssBytes - measurement.cssBytes
		},
		{
			metric: 'Largest asset',
			bytes: measurement.largestAsset.bytes,
			budget: budgets.largestAssetBytes,
			headroom: budgets.largestAssetBytes - measurement.largestAsset.bytes
		}
	];
}

function padLeft(value: string, width: number): string {
	return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

interface Column {
	label: string;
	values: string[];
}

/** Pure: renders the table `buildBudgetTable` produces as aligned text. */
export function formatBudgetTable(rows: BudgetRow[]): string {
	const columns: Column[] = [
		{ label: 'Metric', values: rows.map((row) => row.metric) },
		{ label: 'Bytes', values: rows.map((row) => String(row.bytes)) },
		{ label: 'Budget', values: rows.map((row) => String(row.budget)) },
		{ label: 'Headroom', values: rows.map((row) => String(row.headroom)) }
	];
	const widths = columns.map((column) =>
		Math.max(column.label.length, ...column.values.map((value) => value.length))
	);
	const lines = [
		columns.map((column, index) => padLeft(column.label, widths[index] ?? 0)).join('  '),
		widths.map((width) => '-'.repeat(width)).join('  ')
	];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
		lines.push(
			columns
				.map((column, index) => padLeft(column.values[rowIndex] ?? '', widths[index] ?? 0))
				.join('  ')
		);
	}
	return lines.join('\n');
}

/**
 * Pure: the stable name of a hashed asset file, so the same logical chunk can
 * be matched across two builds whose content hash differs. Vite emits most
 * client chunks as `<name>.<hash>.<ext>`; a few route chunks carry no stable
 * name at all (just `<hash>.<ext>`), and those cannot be matched across
 * builds — they are reported as purely added or removed instead.
 */
export function stableChunkName(relativeFile: string): string {
	const directory = path.posix.dirname(relativeFile);
	const base = path.posix.basename(relativeFile);
	const match = /^(.*)\.[A-Za-z0-9_-]+\.(js|css)$/.exec(base);
	const stableBase = match !== null ? `${match[1]}.${match[2]}` : base;
	return directory === '.' ? stableBase : `${directory}/${stableBase}`;
}

export interface ChunkDelta {
	name: string;
	beforeBytes: number;
	afterBytes: number;
	deltaBytes: number;
}

/** Pure: per-chunk byte deltas between two builds, sorted by |delta| descending. */
export function chunkDeltas(before: Asset[], after: Asset[]): ChunkDelta[] {
	const beforeByName = new Map<string, number>();
	for (const asset of before) beforeByName.set(stableChunkName(asset.file), asset.bytes);
	const afterByName = new Map<string, number>();
	for (const asset of after) afterByName.set(stableChunkName(asset.file), asset.bytes);

	const names = new Set([...beforeByName.keys(), ...afterByName.keys()]);
	const deltas: ChunkDelta[] = [];
	for (const name of names) {
		const beforeBytes = beforeByName.get(name) ?? 0;
		const afterBytes = afterByName.get(name) ?? 0;
		if (beforeBytes === afterBytes) continue;
		deltas.push({ name, beforeBytes, afterBytes, deltaBytes: afterBytes - beforeBytes });
	}
	return deltas.sort((a, b) => Math.abs(b.deltaBytes) - Math.abs(a.deltaBytes));
}

export interface MetricDelta {
	metric: string;
	before: number;
	after: number;
	delta: number;
}

/** Pure: the same three metrics, before vs. after a ref. */
export function metricDeltas(before: Measurement, after: Measurement): MetricDelta[] {
	return [
		{
			metric: 'JS',
			before: before.javascriptBytes,
			after: after.javascriptBytes,
			delta: after.javascriptBytes - before.javascriptBytes
		},
		{
			metric: 'CSS',
			before: before.cssBytes,
			after: after.cssBytes,
			delta: after.cssBytes - before.cssBytes
		},
		{
			metric: 'Largest asset',
			before: before.largestAsset.bytes,
			after: after.largestAsset.bytes,
			delta: after.largestAsset.bytes - before.largestAsset.bytes
		}
	];
}

function signed(bytes: number): string {
	return bytes >= 0 ? `+${bytes}` : `${bytes}`;
}

/** Pure: renders `metricDeltas` output as text. */
export function formatMetricDeltas(deltas: MetricDelta[], ref: string): string {
	const lines = [`Delta against ${ref}:`];
	for (const delta of deltas) {
		lines.push(`  ${delta.metric}: ${delta.before} -> ${delta.after} (${signed(delta.delta)})`);
	}
	return lines.join('\n');
}

/** Pure: renders the top N chunks by absolute byte change. */
export function formatTopChunks(deltas: ChunkDelta[], top = 5): string {
	const shown = deltas.slice(0, top);
	if (shown.length === 0) return 'No chunk changed size.';
	const lines = [`Top ${shown.length} chunk${shown.length === 1 ? '' : 's'} by byte change:`];
	for (const delta of shown) {
		lines.push(
			`  ${delta.name}: ${delta.beforeBytes} -> ${delta.afterBytes} (${signed(delta.deltaBytes)})`
		);
	}
	return lines.join('\n');
}

// ---- IO at the edge ----

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const reportDirectory = path.join(projectRoot, 'reports', 'quality', 'bundle');
const assetRootSegments = ['.svelte-kit', 'output', 'client', '_app', 'immutable'];

async function readBudgets(root: string): Promise<BundleBudgets> {
	return readJsonFile<BundleBudgets>(path.join(root, 'quality', 'bundle-budgets.json'));
}

/**
 * Builds the tree at `root` the same way the `check:bundle` gate does — `bun
 * run build`, nothing more — and measures the client bundle it emits. This is
 * the one place that number is produced, so the gate and this command can
 * never again disagree about what "the build" means. Assets are named
 * relative to the asset root itself (not `root`), so a chunk from one build
 * can be matched against its counterpart in another build that lives at a
 * different path entirely (a scratch worktree for `--against`).
 */
async function buildAndMeasure(root: string): Promise<{ measurement: Measurement }> {
	const exitCode = await run('bun', ['run', 'build'], { cwd: root, allowFailure: true });
	if (exitCode !== 0) throw new Error(`Production build failed in ${root} (exit ${exitCode}).`);
	const assetRoot = path.join(root, ...assetRootSegments);
	const assets = await collectAssets(assetRoot, assetRoot);
	return { measurement: measure(assets) };
}

async function hasNodeModules(root: string): Promise<boolean> {
	try {
		await stat(path.join(root, 'node_modules'));
		return true;
	} catch {
		return false;
	}
}

/**
 * Checks out `ref` into a scratch worktree so it can be built without
 * touching the tree this command is running from. Removed in the caller's
 * `finally` so a crash never leaves a stray worktree registered against this
 * repo.
 */
async function addRefWorktree(ref: string): Promise<string> {
	const scratchParent = await mkdtemp(path.join(tmpdir(), 'fit-bundle-headroom-'));
	await rm(scratchParent, { recursive: true, force: true });
	const { exitCode, output } = await captureStatus(
		'git',
		['worktree', 'add', '--detach', scratchParent, ref],
		{ cwd: projectRoot }
	);
	if (exitCode !== 0) {
		throw new Error(`git worktree add for ${ref} failed:\n${output}`);
	}
	return scratchParent;
}

async function removeRefWorktree(directory: string): Promise<void> {
	await captureStatus('git', ['worktree', 'remove', directory, '--force'], { cwd: projectRoot });
	await rm(directory, { recursive: true, force: true });
}

interface Report {
	assets: Asset[];
	budgets: BundleBudgets;
	cssBytes: number;
	javascriptBytes: number;
	largestAsset: Asset;
	violations: string[];
}

function violationsFor(measurement: Measurement, budgets: BundleBudgets): string[] {
	return [
		measurement.javascriptBytes > budgets.clientJavaScriptBytes
			? `Client JavaScript is ${measurement.javascriptBytes} bytes; budget is ${budgets.clientJavaScriptBytes}.`
			: undefined,
		measurement.cssBytes > budgets.clientCssBytes
			? `Client CSS is ${measurement.cssBytes} bytes; budget is ${budgets.clientCssBytes}.`
			: undefined,
		measurement.largestAsset.bytes > budgets.largestAssetBytes
			? `Largest asset ${measurement.largestAsset.file} is ${measurement.largestAsset.bytes} bytes; budget is ${budgets.largestAssetBytes}.`
			: undefined
	].filter((violation): violation is string => violation !== undefined);
}

/**
 * The one write of `reports/quality/bundle/bundle-budget.json`. Every run of
 * this command rewrites it from what was just measured, so a stale report
 * left over from an old run can never again be read as today's number.
 */
async function writeReport(measurement: Measurement, budgets: BundleBudgets): Promise<void> {
	const report: Report = {
		assets: measurement.assets,
		budgets,
		cssBytes: measurement.cssBytes,
		javascriptBytes: measurement.javascriptBytes,
		largestAsset: measurement.largestAsset,
		violations: violationsFor(measurement, budgets)
	};
	await rm(reportDirectory, { recursive: true, force: true });
	await mkdir(reportDirectory, { recursive: true });
	await writeFile(
		path.join(reportDirectory, 'bundle-budget.json'),
		`${JSON.stringify(report, null, 2)}\n`
	);
}

interface Options {
	against: string | null;
}

function parseArguments(argv: string[]): Options {
	let against: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] !== '--against') continue;
		const value = argv[index + 1];
		if (value === undefined || value.startsWith('--')) {
			against = 'origin/main';
		} else {
			against = value;
			index += 1;
		}
	}
	return { against };
}

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	const budgets = await readBudgets(projectRoot);

	console.log('Building the current tree...');
	const { measurement: current } = await buildAndMeasure(projectRoot);
	await writeReport(current, budgets);

	console.log('');
	console.log(formatBudgetTable(buildBudgetTable(current, budgets)));

	if (options.against !== null) {
		const ref = options.against;
		console.log(`\nBuilding ${ref} in a scratch worktree...`);
		const worktree = await addRefWorktree(ref);
		try {
			if (!(await hasNodeModules(worktree))) {
				const installExit = await run('bun', ['install', '--frozen-lockfile'], {
					cwd: worktree,
					allowFailure: true
				});
				if (installExit !== 0) {
					throw new Error(`bun install --frozen-lockfile failed for ${ref} (exit ${installExit}).`);
				}
			}
			const { measurement: base } = await buildAndMeasure(worktree);
			console.log('');
			console.log(formatMetricDeltas(metricDeltas(base, current), ref));
			console.log('');
			console.log(formatTopChunks(chunkDeltas(base.assets, current.assets)));
		} finally {
			await removeRefWorktree(worktree);
		}
	}
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	await main();
}
