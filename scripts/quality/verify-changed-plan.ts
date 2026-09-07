/**
 * Sizes a gate run to the diff (issue #128, item 2). This module is the pure
 * decision function: given the set of changed files and a handful of
 * environment queries (does this file exist, what imports that file, does it
 * match the mutate patterns), it decides which steps a `verify:changed` run
 * needs — never touching the filesystem or git itself, so it is unit-tested
 * without a real repository. `verify-changed.ts` supplies the real answers
 * and executes the resulting plan.
 */

type PlanCategory = 'static' | 'spec' | 'e2e' | 'mutation' | 'build';

export interface PlanStep {
	category: PlanCategory;
	/** What to run: a step name, a spec path, an e2e path, or a mutation lane. */
	name: string;
	/** Printed beside the step: why it is in the plan. */
	reason: string;
	/** For a `spec` step: the vitest project it must run under. */
	project?: 'server' | 'client';
}

export interface ChangedFile {
	/** Repository-relative, forward-slash path. */
	path: string;
	/** Git name-status letter (`A`, `M`, `D`, `R100`, ...), or `'?'` for an untracked file. */
	status: string;
}

export interface VerifyChangedPlanInput {
	changed: readonly ChangedFile[];
	/** The static step names `verify:fast` always runs, in that tier's order. */
	staticSteps: readonly string[];
	/** Sibling spec paths for a changed source file that exist on disk. */
	siblingSpecs: (file: string) => string[];
	/** Specs (already resolved to paths) that import the changed file. */
	importingSpecs: (file: string) => string[];
	/** Whether a repository-relative path exists. */
	exists: (file: string) => boolean;
	/** Which vitest project a spec belongs to. */
	projectFor: (spec: string) => 'server' | 'client';
	/** Whether a file matches the mutation glob (`quality/mutate-patterns.mjs`). */
	isMutated: (file: string) => boolean;
	/** `--all-browsers`: run every Playwright project instead of `mobile-chrome` alone. */
	allBrowsers: boolean;
}

export interface VerifyChangedPlan {
	steps: PlanStep[];
	/** The single Playwright project the e2e steps run under, unless `allBrowsers`. */
	e2eProject: string;
}

const SPEC_FILE = /\.(?:spec|e2e)\.ts$/;
const SERVER_ROUTE_FILE = /^\+(?:server|page\.server|layout\.server)\.ts$/;
const CLIENT_BUILD_TRIGGER = /^(?:vite|svelte)\.config\.[jt]s$/;

function basename(file: string): string {
	return file.split('/').pop() ?? file;
}

function isSrcFile(file: string): boolean {
	return file.startsWith('src/');
}

/**
 * The "specs" rule reaches `scripts/**` too, not only `src/**`: this repo's
 * gate and mutation machinery lives there with its own specs beside it
 * (`scripts/quality/gate-paths.spec.ts` next to `gate-paths.ts`), and a
 * `scripts/**`-only change should still run the one spec that covers it.
 */
function specEligible(file: string): boolean {
	return isSrcFile(file) || file.startsWith('scripts/');
}

function isSpecFile(file: string): boolean {
	return SPEC_FILE.test(file);
}

/** `src/lib/server/**`, `src/hooks.server.ts`, and any `+server.ts`-shaped route module. */
function isSecuritySurface(file: string): boolean {
	return (
		file === 'src/hooks.server.ts' ||
		file.startsWith('src/lib/server/') ||
		(file.startsWith('src/routes/') && SERVER_ROUTE_FILE.test(basename(file)))
	);
}

function mutationLaneFor(file: string): 'security' | 'changed-client' | 'changed-node' {
	if (isSecuritySurface(file)) return 'security';
	if (file.endsWith('.svelte.ts') || file.endsWith('.svelte')) return 'changed-client';
	return isServerLibrary(file) ? 'changed-node' : 'changed-client';
}

/** `src/lib/domain/**` and `src/lib/server/**` run under the `server` vitest project. */
function isServerLibrary(file: string): boolean {
	return file.startsWith('src/lib/domain/') || file.startsWith('src/lib/server/');
}

function isClientCode(file: string): boolean {
	return isSrcFile(file) && !file.startsWith('src/lib/server/') && !isSpecFile(file);
}

function isBuildTrigger(file: string): boolean {
	return (
		isClientCode(file) || file.startsWith('quality/bundle-') || CLIENT_BUILD_TRIGGER.test(file)
	);
}

/**
 * `src/routes/<name>/...` → `<name>`; a file directly under `src/routes/`
 * (e.g. `src/routes/+layout.svelte`) has no route name to map from.
 */
function routeNameFor(file: string): string | null {
	if (!file.startsWith('src/routes/')) return null;
	const rest = file.slice('src/routes/'.length);
	const slash = rest.indexOf('/');
	if (slash === -1) return null;
	return rest.slice(0, slash);
}

function planStatic(input: VerifyChangedPlanInput): PlanStep[] {
	return input.staticSteps.map((name) => ({ category: 'static', name, reason: 'always' }));
}

function planSpecs(input: VerifyChangedPlanInput): PlanStep[] {
	const steps: PlanStep[] = [];
	const seen = new Set<string>();
	const add = (spec: string, reason: string): void => {
		if (seen.has(spec)) return;
		seen.add(spec);
		steps.push({ category: 'spec', name: spec, reason, project: input.projectFor(spec) });
	};
	for (const { path: file } of input.changed) {
		if (!specEligible(file)) continue;
		// `isSpecFile` also matches `.e2e.ts` (it doubles as the "not client code"
		// check `isClientCode` needs), but no vitest project ever includes an
		// `.e2e.ts` file — `planE2e` below is what runs those. Adding one here
		// sent it to vitest as a "changed directly" spec, which failed every
		// time with "No test files found" (#152).
		if (isSpecFile(file) && !file.endsWith('.e2e.ts')) {
			add(file, 'changed directly');
			continue;
		}
		for (const spec of input.siblingSpecs(file)) add(spec, `sibling of ${file}`);
		for (const spec of input.importingSpecs(file)) add(spec, `imports ${file}`);
	}
	return steps;
}

function planE2e(input: VerifyChangedPlanInput): PlanStep[] {
	const steps: PlanStep[] = [];
	const seen = new Set<string>();
	const add = (name: string, reason: string): void => {
		if (seen.has(name)) return;
		seen.add(name);
		steps.push({ category: 'e2e', name, reason });
	};
	let fullSuite = false;
	let fullSuiteReason = '';
	for (const { path: file } of input.changed) {
		if (!isSrcFile(file)) continue;
		if (SPEC_FILE.test(file) && file.endsWith('.e2e.ts')) {
			add(file, 'changed directly');
			continue;
		}
		if (file.endsWith('.svelte')) {
			if (file.startsWith('src/lib/components/')) {
				fullSuite = true;
				fullSuiteReason = `component change: ${file}`;
				continue;
			}
			const name = routeNameFor(file);
			if (name === null) continue;
			const candidates = [`src/routes/${name}.e2e.ts`, `src/routes/${name}/${name}.e2e.ts`];
			const found = candidates.find((candidate) => input.exists(candidate));
			if (found !== undefined) add(found, `route e2e for src/routes/${name}/**`);
			continue;
		}
		const name = routeNameFor(file);
		if (name === null) continue;
		const candidates = [`src/routes/${name}.e2e.ts`, `src/routes/${name}/${name}.e2e.ts`];
		const found = candidates.find((candidate) => input.exists(candidate));
		if (found !== undefined) add(found, `route e2e for src/routes/${name}/**`);
	}
	if (fullSuite) return [{ category: 'e2e', name: 'full suite', reason: fullSuiteReason }];
	return steps;
}

function planMutation(input: VerifyChangedPlanInput): PlanStep[] {
	const lanes = new Map<string, string[]>();
	for (const { path: file } of input.changed) {
		if (!isSrcFile(file) || isSpecFile(file) || !input.isMutated(file)) continue;
		const lane = mutationLaneFor(file);
		const files = lanes.get(lane) ?? [];
		files.push(file);
		lanes.set(lane, files);
	}
	return [...lanes.entries()].map(([lane, files]) => ({
		category: 'mutation',
		name: lane,
		reason: `matches mutate patterns: ${files.join(', ')}`
	}));
}

function planBuild(input: VerifyChangedPlanInput): PlanStep[] {
	const triggers = input.changed.filter(({ path: file }) => isBuildTrigger(file));
	if (triggers.length === 0) return [];
	const reason = `client or build config changed: ${triggers.map(({ path }) => path).join(', ')}`;
	return [
		{ category: 'build', name: 'build', reason },
		{ category: 'build', name: 'check:bundle', reason }
	];
}

export function buildVerifyChangedPlan(input: VerifyChangedPlanInput): VerifyChangedPlan {
	return {
		steps: [
			...planStatic(input),
			...planSpecs(input),
			...planE2e(input),
			...planMutation(input),
			...planBuild(input)
		],
		e2eProject: input.allBrowsers ? 'all' : 'mobile-chrome'
	};
}
