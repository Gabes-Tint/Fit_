import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { isExcludedFromMutation } from './mutation-globs';
import type { LineRange, MutationLane, MutationScope, MutationScopeFile } from './mutation-types';

const TEST_FILE = /\.(?:test|spec|e2e)\.[jt]s$/;
const SERVER_ROUTE = /^\+(?:server|page\.server|layout\.server)\.ts$/;
// A route's server spec sits beside its `+server.ts` sibling but drops the
// leading `+` (SvelteKit reserves `+`-prefixed names for its own modules), e.g.
// `src/routes/api/accounts/server.spec.ts` next to `src/routes/api/accounts/+server.ts`.
const SERVER_ROUTE_SPEC = /^(?:server|page\.server|layout\.server)\.spec\.ts$/;
const CROSS_CUTTING = [
	'bun.lock',
	'package.json',
	'stryker.config.mjs',
	'tsconfig.json',
	'vite.config.ts',
	'quality/mutation-policy.json',
	// Moved out of the configs above; editing either still redraws a lane's scope.
	'quality/mutate-patterns.mjs',
	'quality/dom-free-client-specs.mjs'
];

interface ChangedPath {
	status: string;
	path: string;
	untracked?: boolean;
}

function normalize(root: string, file: string): string {
	return path.relative(root, file).split(path.sep).join('/');
}

/** Exported for `mutation-oracle.ts`. */
export async function walk(directory: string): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	const files = await Promise.all(
		entries.map(async (entry) => {
			const target = path.join(directory, entry.name);
			return entry.isDirectory() ? walk(target) : [target];
		})
	);
	return files.flat();
}

/**
 * Shared with `mutation-oracle.ts` so the scope and its check cannot disagree
 * about what counts as production code.
 */
export function isProductionTypeScript(file: string): boolean {
	return file.endsWith('.ts') && !file.endsWith('.d.ts') && !TEST_FILE.test(file);
}

/**
 * Whether a lane mutates this repository-relative path: exactly what
 * `fullSources` below selects, and the one place that rule is written down.
 *
 * Every caller that decides "would mutation testing touch this file?" asks
 * here. Restating it is how `verify:changed` came to plan with `src/lib/**`
 * while the security lane mutated nine `+server.ts` handlers and
 * `src/hooks.server.ts` besides (#129) — the include glob in
 * `quality/mutate-patterns.mjs` describes only a bare `stryker run`, and every
 * lane walks all of `src/` instead.
 */
export function isMutated(file: string): boolean {
	return file.startsWith('src/') && isProductionTypeScript(file) && !isExcludedFromMutation(file);
}

export async function discoverSecurityRoots(projectRoot: string): Promise<string[]> {
	const sourceRoot = path.join(projectRoot, 'src');
	const candidates = await walk(sourceRoot);
	return candidates
		.filter(isProductionTypeScript)
		.map((file) => normalize(projectRoot, file))
		.filter(
			(file) =>
				file === 'src/hooks.server.ts' ||
				file.startsWith('src/lib/server/') ||
				(file.startsWith('src/routes/') && SERVER_ROUTE.test(path.posix.basename(file)))
		)
		.sort();
}

function runtimeSpecifiers(source: string, fileName: string): string[] {
	const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const imports: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node)) {
			if (node.importClause?.isTypeOnly !== true && ts.isStringLiteral(node.moduleSpecifier)) {
				imports.push(node.moduleSpecifier.text);
			}
		} else if (ts.isExportDeclaration(node)) {
			if (
				node.isTypeOnly !== true &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				imports.push(node.moduleSpecifier.text);
			}
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const argument = node.arguments[0];
			if (
				node.arguments.length === 1 &&
				argument !== undefined &&
				(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
			) {
				imports.push(argument.text);
			} else {
				throw new Error(`Cannot prove mutation scope for computed dynamic import in ${fileName}.`);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return imports;
}

function compilerOptions(projectRoot: string): ts.CompilerOptions {
	const configPath = ts.findConfigFile(
		projectRoot,
		(file) => ts.sys.fileExists(file),
		'tsconfig.json'
	);
	if (configPath === undefined) throw new Error('Could not find tsconfig.json.');
	const loaded = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
	if (loaded.error !== undefined)
		throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
	return ts.parseJsonConfigFileContent(loaded.config, ts.sys, projectRoot).options;
}

export async function expandRuntimeImports(
	projectRoot: string,
	roots: readonly string[]
): Promise<string[]> {
	const options = compilerOptions(projectRoot);
	const queue = [...roots];
	const found = new Set<string>();
	while (queue.length > 0) {
		const relative = queue.shift();
		if (relative === undefined || found.has(relative)) continue;
		found.add(relative);
		const absolute = path.join(projectRoot, relative);
		const source = await readFile(absolute, 'utf8');
		for (const specifier of runtimeSpecifiers(source, absolute)) {
			const resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule;
			if (resolved === undefined || resolved.isExternalLibraryImport === true) continue;
			const imported = normalize(projectRoot, resolved.resolvedFileName.replace(/\.d\.ts$/, '.ts'));
			if (imported.startsWith('src/') && isProductionTypeScript(imported) && !found.has(imported)) {
				queue.push(imported);
			}
		}
	}
	return [...found].sort();
}

function git(projectRoot: string, args: string[]): string {
	return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
}

function resolveMutationBase(projectRoot: string, requested?: string): string | null {
	const candidates = [
		requested,
		process.env.MUTATION_BASE,
		process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
		'origin/main',
		'HEAD^'
	].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
	for (const candidate of candidates) {
		try {
			return git(projectRoot, ['merge-base', 'HEAD', candidate]);
		} catch {
			// A base that fails to resolve falls through; a missing base forces broad scope.
		}
	}
	return null;
}

function changedPaths(projectRoot: string, base: string): ChangedPath[] {
	const output = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', base], {
		cwd: projectRoot,
		encoding: 'utf8'
	});
	const fields = output.split('\0').filter(Boolean);
	const changes: ChangedPath[] = [];
	for (let index = 0; index < fields.length;) {
		const status = fields[index++];
		const first = fields[index++];
		if (status === undefined || first === undefined) break;
		if (status.startsWith('R') || status.startsWith('C')) {
			const destination = fields[index++];
			if (destination !== undefined) changes.push({ status, path: destination });
		} else changes.push({ status, path: first });
	}
	const tracked = new Set(changes.map(({ path: file }) => file));
	const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
		cwd: projectRoot,
		encoding: 'utf8'
	})
		.split('\0')
		.filter(Boolean);
	for (const file of untracked) {
		if (!tracked.has(file)) changes.push({ status: 'A', path: file, untracked: true });
	}
	return changes;
}

async function wholeFileRange(projectRoot: string, file: string): Promise<LineRange[]> {
	const source = await readFile(path.join(projectRoot, file), 'utf8');
	const lineCount = source.endsWith('\n')
		? source.split('\n').length - 1
		: source.split('\n').length;
	return lineCount === 0 ? [] : [{ start: 1, end: lineCount }];
}

function changedLineRanges(projectRoot: string, base: string, file: string): LineRange[] {
	let output: string;
	try {
		output = execFileSync('git', ['diff', '--unified=0', base, '--', file], {
			cwd: projectRoot,
			encoding: 'utf8'
		});
	} catch {
		return [];
	}
	const ranges: LineRange[] = [];
	for (const line of output.split('\n')) {
		const match = /^@@ -[^ ]+ \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (match === null) continue;
		const start = Number(match[1]);
		const count = Number(match[2] ?? '1');
		if (count > 0) ranges.push({ start, end: start + count - 1 });
	}
	return ranges;
}

/**
 * Which vitest project owns a source file. Shared with `mutation-oracle.ts` so
 * the scope and its check cannot disagree.
 */
export function isServerSource(file: string): boolean {
	return (
		file.startsWith('src/lib/domain/') ||
		file.startsWith('src/lib/server/') ||
		file.endsWith('.server.ts') ||
		SERVER_ROUTE.test(path.posix.basename(file)) ||
		(file.startsWith('src/routes/') && SERVER_ROUTE_SPEC.test(path.posix.basename(file)))
	);
}

async function fullSources(
	projectRoot: string,
	project: 'server' | 'client' | 'all'
): Promise<string[]> {
	const files = (await walk(path.join(projectRoot, 'src')))
		.map((file) => normalize(projectRoot, file))
		.filter(isMutated);
	if (project === 'server') return files.filter(isServerSource).sort();
	if (project === 'client') return files.filter((file) => !isServerSource(file)).sort();
	return files.sort();
}

function isCrossCutting(file: string): boolean {
	return (
		CROSS_CUTTING.includes(file) ||
		file.startsWith('scripts/quality/mutation-') ||
		file.startsWith('quality/mutation-')
	);
}

function belongsToProject(file: string, project: 'server' | 'client'): boolean {
	const server =
		file === 'src/hooks.server.spec.ts' ||
		file.startsWith('src/lib/domain/') ||
		file.startsWith('src/lib/server/') ||
		file.endsWith('.server.ts') ||
		SERVER_ROUTE.test(path.posix.basename(file)) ||
		(file.startsWith('src/routes/') && SERVER_ROUTE_SPEC.test(path.posix.basename(file)));
	return project === 'server' ? server : !server;
}

function isSecurityTest(file: string, securityFiles: ReadonlySet<string>): boolean {
	if (!TEST_FILE.test(file)) return false;
	if (file.startsWith('src/lib/server/') || file === 'src/hooks.server.spec.ts') return true;
	const production = file.replace(/\.(?:test|spec)\.ts$/, '.ts');
	return securityFiles.has(production);
}

function scopeFiles(
	paths: readonly string[],
	lines: ReadonlyMap<string, LineRange[]>,
	statuses: ReadonlyMap<string, string>
): MutationScopeFile[] {
	return [...new Set(paths)].sort().map((file) => ({
		path: file,
		changeStatus: statuses.get(file) ?? null,
		changedLines: lines.get(file) ?? []
	}));
}

export async function buildMutationScope(
	projectRoot: string,
	lane: MutationLane,
	requestedBase?: string
): Promise<MutationScope> {
	const securityRoots = await discoverSecurityRoots(projectRoot);
	const securityFiles = await expandRuntimeImports(projectRoot, securityRoots);
	const securityFileSet = new Set(securityFiles);
	const base = resolveMutationBase(projectRoot, requestedBase);
	const project = lane === 'changed-client' ? 'client' : lane === 'full' ? 'all' : 'server';
	const changes = base === null ? [] : changedPaths(projectRoot, base);
	const lines = new Map<string, LineRange[]>();
	const statuses = new Map(changes.map((change) => [change.path, change.status]));
	if (base !== null) {
		for (const change of changes) {
			lines.set(
				change.path,
				change.untracked === true
					? await wholeFileRange(projectRoot, change.path)
					: changedLineRanges(projectRoot, base, change.path)
			);
		}
	}

	if (lane === 'security') {
		return {
			version: 2,
			lane,
			project,
			base,
			fallback: null,
			files: scopeFiles(securityFiles, lines, statuses)
		};
	}
	if (lane === 'full') {
		return {
			version: 2,
			lane,
			project,
			base,
			fallback: null,
			files: scopeFiles(await fullSources(projectRoot, 'all'), lines, statuses)
		};
	}

	const changedProject = project as 'server' | 'client';
	const broadReason =
		base === null
			? 'no-comparable-base'
			: changes.some(({ status }) => status.startsWith('D') || status.startsWith('R'))
				? 'deleted-or-renamed-input'
				: changes.some(({ path: file }) => isCrossCutting(file))
					? 'mutation-infrastructure-changed'
					: changes.some(
								({ path: file }) =>
									(file.endsWith('.json') && belongsToProject(file, changedProject)) ||
									(changedProject === 'client' && file.endsWith('.svelte'))
						  )
						? 'non-mutated-runtime-input-changed'
						: changes.some(
									({ path: file }) =>
										TEST_FILE.test(file) &&
										belongsToProject(file, changedProject) &&
										!isSecurityTest(file, securityFileSet)
							  )
							? 'test-input-changed'
							: null;
	const files =
		broadReason === null
			? changes
					.filter(
						({ status, path: file }) =>
							(status.startsWith('A') || status.startsWith('M') || status.startsWith('C')) &&
							isProductionTypeScript(file) &&
							belongsToProject(file, changedProject) &&
							!securityFiles.includes(file) &&
							!isExcludedFromMutation(file)
					)
					.map(({ path: file }) => file)
			: (await fullSources(projectRoot, changedProject)).filter(
					(file) => !securityFiles.includes(file)
				);
	return {
		version: 2,
		lane,
		project,
		base,
		fallback: broadReason,
		files: scopeFiles(files, lines, statuses)
	};
}
