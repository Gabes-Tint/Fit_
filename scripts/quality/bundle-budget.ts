import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readJsonFile } from '../security/shared';
import { collectAssets, measure } from './bundle-assets';
import { collectAlwaysLoadedAssets } from './bundle-closure';
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
 * the diff. Both numbers are measured in `docs/bundle-audit.md`.
 */
const MEASUREMENT_NOISE = [
	'Before hunting a small delta in the diff, subtract the noise:',
	'  8 bytes — the version stamp. main is tagged on every merge and stamps `v0.0.NN`;',
	'    a branch is ahead of its tag and stamps `v0.0.NN+<sha>`, eight characters longer.',
	'    Every branch build therefore starts eight bytes above the main it is compared to.',
	"  4 bytes — SvelteKit's random `__sveltekit_<token>` identifier, which is six or seven",
	'    characters and appears four times, so two builds of one identical tree differ by four.',
	'Treat a change of about a dozen bytes as measuring the build, not the code.'
].join('\n');

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
