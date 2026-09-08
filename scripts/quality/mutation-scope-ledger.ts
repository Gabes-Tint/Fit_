import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readJsonFile } from '../security/shared';
import { isMutated, walk } from './mutation-scope';

/**
 * The mutation lanes do not reach every source file, and that is a decision
 * rather than an accident of a glob (#76). This makes the decision auditable:
 * it enumerates the source files no lane can mutate, sorts them into named
 * areas that each say what covers them instead, and fails when the enumeration
 * and `quality/mutation-uncovered.json` disagree.
 *
 * The point is visibility, not a score. A new component or a new deploy script
 * lands in a blind spot silently today; after this it lands with a line in the
 * ledger that a reviewer has to accept on purpose. Widening the mutation glob
 * is a separate, deliberate call and this check neither makes it nor blocks it.
 *
 * What a lane mutates is asked of `mutation-scope.ts` and `mutation-globs.ts`
 * rather than restated, so the ledger cannot drift from the lanes it describes:
 * `buildMutationScope` selects exactly the production TypeScript under `src/`
 * that no `!` pattern excludes, and this asks the same two predicates.
 */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export const LEDGER_PATH = 'quality/mutation-uncovered.json';

/** Where source lives. Anything outside these is configuration, not code under test. */
export const SOURCE_ROOTS = ['src', 'scripts', 'tests'] as const;

/**
 * Extensions that carry executable logic. `.js`, `.mjs` and `.cjs` are listed
 * even though none exists under the roots today: a blind spot the check cannot
 * see is worse than a ledger line for a file that never appears.
 */
const SOURCE_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte'];

const TEST_FILE = /\.(?:test|spec|e2e)\.[cm]?[jt]s$/;

export interface UncoveredArea {
	id: string;
	/** What the area holds, for the summary line and the failure message. */
	holds: string;
	/** What actually tests this area today. Verified against the tree, not assumed. */
	coveredBy: string;
	matches: (file: string) => boolean;
}

/**
 * Ordered; the first match owns the file. Every claim in `coveredBy` was checked
 * against the tree on 2026-09-07 and the checks are named in QUALITY.md, "What
 * the mutation lanes do not reach", so a reader can redo them.
 */
export const UNCOVERED_AREAS: readonly UncoveredArea[] = [
	{
		id: 'excluded-by-pattern',
		holds: 'production TypeScript under src/ that a `!` pattern removes from the lanes',
		coveredBy:
			'each exclusion carries its own reason at the pattern in quality/mutate-patterns.mjs',
		matches: (file) => file.startsWith('src/') && file.endsWith('.ts')
	},
	{
		id: 'library-components',
		holds: 'Svelte components under src/lib/',
		coveredBy:
			'component specs in the vitest browser project, plus the per-file 80% coverage floor, which includes src/lib/**/*.svelte',
		matches: (file) => file.startsWith('src/lib/') && file.endsWith('.svelte')
	},
	{
		id: 'route-components',
		holds: 'Svelte components under src/routes/',
		coveredBy:
			'Playwright end-to-end flows and some page specs; no coverage floor reaches them, because the coverage include is src/lib only',
		matches: (file) => file.startsWith('src/routes/') && file.endsWith('.svelte')
	},
	{
		id: 'tooling-scripts',
		holds: 'build, deploy, security and quality tooling under scripts/',
		coveredBy:
			'unit specs run by the vitest server project where a script has one; nothing requires that it has one, and no coverage floor applies',
		matches: (file) => file.startsWith('scripts/')
	},
	{
		id: 'e2e-harness',
		holds: 'the end-to-end harness under tests/',
		coveredBy:
			'tests/e2e-workspace.spec.ts covers the workspace builder; the rest is exercised only by running the end-to-end suite',
		matches: (file) => file.startsWith('tests/')
	}
];

const areaIds = new Set(UNCOVERED_AREAS.map(({ id }) => id));

export interface UncoveredLedger {
	version: number;
	areas: Record<string, string[]>;
}

export function isSourceFile(file: string): boolean {
	return (
		SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension)) &&
		!file.endsWith('.d.ts') &&
		!TEST_FILE.test(file)
	);
}

/** The area a file belongs to, or `null` when no area claims it. */
export function areaOf(file: string): string | null {
	return UNCOVERED_AREAS.find(({ matches }) => matches(file))?.id ?? null;
}

/**
 * Which area each source file outside the mutation lanes belongs to. A file no
 * area claims is returned under `unclaimed`: a new source root would otherwise
 * be invisible to both this check and the lanes it describes.
 */
export function classify(files: readonly string[]): {
	byArea: Map<string, string[]>;
	unclaimed: string[];
} {
	const byArea = new Map(UNCOVERED_AREAS.map(({ id }) => [id, [] as string[]]));
	const unclaimed: string[] = [];
	for (const file of [...files].sort()) {
		if (!isSourceFile(file) || isMutated(file)) continue;
		const area = areaOf(file);
		if (area === null) unclaimed.push(file);
		else byArea.get(area)?.push(file);
	}
	return { byArea, unclaimed };
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Structural complaints about the ledger file itself, before it is compared to the tree. */
export function ledgerShapeFailures(ledger: unknown): string[] {
	const failures: string[] = [];
	if (typeof ledger !== 'object' || ledger === null || Array.isArray(ledger)) {
		return [`${LEDGER_PATH} must be a JSON object.`];
	}
	const record = ledger as Record<string, unknown>;
	if (record['version'] !== 1) failures.push(`${LEDGER_PATH} must declare "version": 1.`);
	const areas = record['areas'];
	if (typeof areas !== 'object' || areas === null || Array.isArray(areas)) {
		failures.push(`${LEDGER_PATH} must have an "areas" object.`);
		return failures;
	}
	for (const [id, entries] of Object.entries(areas as Record<string, unknown>)) {
		if (!areaIds.has(id)) {
			failures.push(
				`${LEDGER_PATH} has an unknown area "${id}". Known areas: ${[...areaIds].join(', ')}.`
			);
			continue;
		}
		if (!isStringArray(entries)) {
			failures.push(`${LEDGER_PATH} area "${id}" must be an array of paths.`);
			continue;
		}
		const sorted = [...entries].sort();
		if (entries.some((entry, index) => entry !== sorted[index])) {
			failures.push(`${LEDGER_PATH} area "${id}" must be sorted, so a diff shows one added line.`);
		}
		if (new Set(entries).size !== entries.length) {
			failures.push(`${LEDGER_PATH} area "${id}" lists the same path twice.`);
		}
	}
	for (const id of areaIds) {
		if (!Object.hasOwn(areas, id)) {
			failures.push(`${LEDGER_PATH} is missing area "${id}"; record it, empty if it has no files.`);
		}
	}
	return failures;
}

/** What the ledger and the tree disagree about. Empty means the record is exact. */
export function ledgerFailures(ledger: UncoveredLedger, files: readonly string[]): string[] {
	const failures = ledgerShapeFailures(ledger);
	if (failures.length > 0) return failures;
	const { byArea, unclaimed } = classify(files);
	for (const file of unclaimed) {
		failures.push(
			`${file} is a source file outside every mutation lane and no ledger area claims it. ` +
				`Give it an area in scripts/quality/mutation-scope-ledger.ts, saying what covers it.`
		);
	}
	for (const area of UNCOVERED_AREAS) {
		const recorded = new Set(ledger.areas[area.id] ?? []);
		const actual = byArea.get(area.id) ?? [];
		for (const file of actual) {
			if (!recorded.has(file)) {
				failures.push(
					`${file} is outside every mutation lane and is not on the ledger under "${area.id}". ` +
						`What covers that area today: ${area.coveredBy}. Add the path to ${LEDGER_PATH} once you are content with that.`
				);
			}
		}
		const actualSet = new Set(actual);
		for (const file of recorded) {
			if (!actualSet.has(file)) {
				failures.push(
					`${LEDGER_PATH} lists ${file} under "${area.id}", but it is gone or a mutation lane reaches it now. ` +
						`Remove the line: a stale ledger hides the next real blind spot.`
				);
			}
		}
	}
	return failures;
}

export function renderLedger(files: readonly string[]): string {
	const { byArea } = classify(files);
	const areas = Object.fromEntries(UNCOVERED_AREAS.map(({ id }) => [id, byArea.get(id) ?? []]));
	return `${JSON.stringify({ version: 1, areas }, null, '\t')}\n`;
}

export async function sourceFiles(root: string): Promise<string[]> {
	const found = await Promise.all(
		SOURCE_ROOTS.map(async (directory) =>
			(await walk(path.join(root, directory))).map((file) =>
				path.relative(root, file).split(path.sep).join('/')
			)
		)
	);
	return found.flat().filter(isSourceFile).sort();
}

if (import.meta.main) {
	const files = await sourceFiles(projectRoot);
	const ledgerFile = path.join(projectRoot, LEDGER_PATH);
	if (process.argv.includes('--write')) {
		await writeFile(ledgerFile, renderLedger(files));
		console.log(`Wrote ${LEDGER_PATH}. Review every added line before committing it.`);
	} else {
		const ledger = await readJsonFile<UncoveredLedger>(ledgerFile);
		const failures = ledgerFailures(ledger, files);
		if (failures.length === 0) {
			const { byArea } = classify(files);
			const summary = UNCOVERED_AREAS.map(
				({ id }) => `${id} ${(byArea.get(id) ?? []).length}`
			).join(', ');
			console.log(`Mutation scope ledger is exact: ${summary}.`);
		} else {
			for (const failure of failures) console.error(failure);
			console.error(
				`\nThe mutation lanes cover production TypeScript under src/ only. Nothing here widens them; ` +
					`record the file and what covers it, or run \`bun scripts/quality/mutation-scope-ledger.ts --write\` and read the diff.`
			);
			process.exitCode = 1;
		}
	}
}
