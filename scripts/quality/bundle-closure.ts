import { stat } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from '../security/shared';
import type { Asset } from './bundle-assets';

/**
 * The always-loaded closure: the JavaScript a browser fetches before it knows
 * which page it is on. That is the SvelteKit client entry, the generated app
 * shell, the root layout node — which every route renders inside — and
 * everything those three import *statically*.
 *
 * It exists because the tree total in `bundle-budget.ts` sums every chunk as
 * if one visitor downloaded all sixteen route nodes at once. Nobody does, so
 * that number cannot tell "we shipped more code" apart from "we split code
 * better" and scores the second as a regression: the audit measured a lazy
 * `LogSheet` cutting the root layout chunk from 75,036 to 42,661 bytes while
 * *failing* the gate, because the new chunk boundaries added 2,109 bytes to
 * the tree. This number moves the other way — down when code is split out of
 * the shell, up when code is added to it — so the two budgets together reward
 * the split and still catch the growth. See `docs/bundle-audit.md`.
 *
 * Dynamic imports are excluded deliberately; they are the whole point of the
 * metric. Route nodes reach the browser through the shell's `dynamicImports`,
 * so only node 0 — the root layout, named as a root here — is counted.
 */

/** The fields of a Vite manifest entry this closure needs. */
interface ManifestChunk {
	file: string;
	isEntry?: boolean;
	imports?: string[];
	dynamicImports?: string[];
}

/** `.svelte-kit/output/client/.vite/manifest.json`, keyed by source module. */
export type ClientManifest = Record<string, ManifestChunk>;

/**
 * SvelteKit's generated route nodes, `.../nodes/<n>.js`. Node 0 is always the
 * root layout; every other node belongs to one route.
 */
const ROUTE_NODE = /(?:^|\/)nodes\/(\d+)\.js$/;

/**
 * Pure: the manifest keys loaded on every page. Keys are source module paths,
 * which are stable; only the `file` each one points at carries a content hash,
 * so nothing here can be spelled as a chunk name that changes every build.
 */
export function alwaysLoadedRoots(manifest: ClientManifest): string[] {
	const keys = Object.keys(manifest);
	const shell = keys.filter((key) => manifest[key]?.isEntry === true && !ROUTE_NODE.test(key));
	const rootLayout = keys.filter((key) => ROUTE_NODE.exec(key)?.[1] === '0');
	if (shell.length === 0 || rootLayout.length === 0) {
		throw new Error(
			'Client manifest has no shell entry or no root layout node (a key ending in nodes/0.js). ' +
				'Without both, the always-loaded closure would silently measure nothing.'
		);
	}
	return [...shell, ...rootLayout];
}

/**
 * Pure: every emitted file reachable from those roots through static imports,
 * each named once however many roots reach it.
 */
export function alwaysLoadedFiles(manifest: ClientManifest): string[] {
	const visited = new Set<string>();
	const files: string[] = [];
	const pending = alwaysLoadedRoots(manifest);
	while (pending.length > 0) {
		const key = pending.pop();
		if (key === undefined || visited.has(key)) continue;
		const chunk = manifest[key];
		if (chunk === undefined) {
			throw new Error(`Client manifest imports ${key}, which it does not describe.`);
		}
		visited.add(key);
		files.push(chunk.file);
		pending.push(...(chunk.imports ?? []));
	}
	return files.sort();
}

/**
 * Reads the manifest the client build emits and sizes the closure it
 * describes. `clientRoot` is `.svelte-kit/output/client`, the directory the
 * manifest's `file` paths are relative to; the returned `file` names keep that
 * form so a report row can be matched against the tree-total asset list.
 */
export async function collectAlwaysLoadedAssets(clientRoot: string): Promise<Asset[]> {
	const manifestPath = path.join(clientRoot, '.vite', 'manifest.json');
	let manifest: ClientManifest;
	try {
		manifest = await readJsonFile<ClientManifest>(manifestPath);
	} catch (error) {
		throw new Error('No client manifest to read. Run `bun run build` first.', { cause: error });
	}
	const assets: Asset[] = [];
	for (const file of alwaysLoadedFiles(manifest)) {
		if (!file.endsWith('.js')) continue;
		assets.push({ bytes: (await stat(path.join(clientRoot, file))).size, file });
	}
	return assets;
}
