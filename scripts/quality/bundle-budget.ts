import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readJsonFile } from '../security/shared';
import { collectAssets, measure } from './bundle-assets';
import type { BundleBudgets } from './config-types';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const assetRoot = path.join(projectRoot, '.svelte-kit', 'output', 'client', '_app', 'immutable');
const reportDirectory = path.join(projectRoot, 'reports', 'quality', 'bundle');
const budgets = await readJsonFile<BundleBudgets>(
	path.join(projectRoot, 'quality', 'bundle-budgets.json')
);

const { assets, javascriptBytes, cssBytes, largestAsset } = measure(
	await collectAssets(assetRoot, projectRoot)
);
const violations = [
	javascriptBytes > budgets.clientJavaScriptBytes
		? `Client JavaScript is ${javascriptBytes} bytes; budget is ${budgets.clientJavaScriptBytes}.`
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
	`${JSON.stringify({ assets, budgets, cssBytes, javascriptBytes, largestAsset, violations }, null, 2)}\n`
);

console.log(
	`Bundle: ${javascriptBytes} JS bytes, ${cssBytes} CSS bytes, ${largestAsset.bytes} largest asset bytes.`
);
if (violations.length > 0) throw new Error(violations.join('\n'));
