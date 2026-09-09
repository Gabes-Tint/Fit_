import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readJsonFile, run } from '../security/shared';
import { collectAssets, measure } from './bundle-assets';
import { collectAlwaysLoadedAssets } from './bundle-closure';
import { BUNDLE_MEASUREMENT_ENV } from '../build/bundle-measurement-version';
import type { BundleBudgets } from './config-types';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const clientRoot = path.join(projectRoot, '.svelte-kit', 'output', 'client');
const assetRoot = path.join(clientRoot, '_app', 'immutable');
const reportDirectory = path.join(projectRoot, 'reports', 'quality', 'bundle');
const budgets = await readJsonFile<BundleBudgets>(
	path.join(projectRoot, 'quality', 'bundle-budgets.json')
);

/**
 * Printed with every failure because a handful of bytes is not signal, and
 * without this note the first move on a near-miss is to go looking for them in
 * the diff. Measured in `docs/bundle-audit.md`.
 */
const MEASUREMENT_NOISE = [
	'Before hunting a small delta in the diff, subtract the noise:',
	"  4 bytes — SvelteKit's random `__sveltekit_<token>` identifier, which is six or seven",
	'    characters and appears four times, so two builds of one identical tree differ by four.',
	'Treat a change of about a dozen bytes as measuring the build, not the code.'
].join('\n');

/**
 * This gate used to measure whatever `.svelte-kit/output/client` already
 * held, so a stale build left over from a previous run — or one built with a
 * different, variably-long `git describe` version string — could get
 * measured instead of the tree at HEAD. Building fresh every time, with
 * `BUNDLE_MEASUREMENT_ENV` set, fixes both: the client bundle measured here
 * is always the one this checkout would produce right now, and it always
 * embeds the fixed-length placeholder version from
 * `bundle-measurement-version.ts` rather than the real one, so the byte
 * count never depends on how long the current tag distance happens to be.
 * See `docs/bundle-audit.md`.
 */
console.log('Building for measurement...');
await run('bun', ['run', 'build'], {
	env: { ...process.env, [BUNDLE_MEASUREMENT_ENV]: '1' }
});

const { assets, javascriptBytes, cssBytes, largestAsset } = measure(
	await collectAssets(assetRoot, projectRoot)
);
const alwaysLoadedAssets = await collectAlwaysLoadedAssets(clientRoot);
const alwaysLoadedJavaScriptBytes = measure(alwaysLoadedAssets).javascriptBytes;

const violations = [
	javascriptBytes > budgets.clientJavaScriptBytes
		? `Client JavaScript is ${javascriptBytes} bytes; budget is ${budgets.clientJavaScriptBytes}.`
		: undefined,
	alwaysLoadedJavaScriptBytes > budgets.alwaysLoadedJavaScriptBytes
		? `Always-loaded JavaScript is ${alwaysLoadedJavaScriptBytes} bytes across ${alwaysLoadedAssets.length} chunks; budget is ${budgets.alwaysLoadedJavaScriptBytes}. This is what every page pays before it knows which page it is; splitting code behind a dynamic import takes it out of this number.`
		: undefined,
	cssBytes > budgets.clientCssBytes
		? `Client CSS is ${cssBytes} bytes; budget is ${budgets.clientCssBytes}.`
		: undefined,
	largestAsset.bytes > budgets.largestAssetBytes
		? `Largest asset ${largestAsset.file} is ${largestAsset.bytes} bytes; budget is ${budgets.largestAssetBytes}.`
		: undefined
].filter((violation): violation is string => violation !== undefined);

await rm(reportDirectory, { recursive: true, force: true });
await mkdir(reportDirectory, { recursive: true });
await writeFile(
	path.join(reportDirectory, 'bundle-budget.json'),
	`${JSON.stringify(
		{
			alwaysLoadedAssets,
			alwaysLoadedJavaScriptBytes,
			assets,
			budgets,
			cssBytes,
			javascriptBytes,
			largestAsset,
			violations
		},
		null,
		2
	)}\n`
);

console.log(
	`Bundle: ${javascriptBytes} JS bytes (${alwaysLoadedJavaScriptBytes} of them always loaded), ${cssBytes} CSS bytes, ${largestAsset.bytes} largest asset bytes.`
);
if (violations.length > 0) throw new Error(`${violations.join('\n')}\n\n${MEASUREMENT_NOISE}`);
