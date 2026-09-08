import { readFile, readdir } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { catalogPath, openCatalog } from '../../src/lib/server/catalog/connection.ts';
import { openDatabase } from '../../src/lib/server/db.ts';
import { createFixtureCatalog } from '../../tests/catalog-fixture.ts';
// The extension is explicit for the reason `scripts/eval/search-eval.ts` gives:
// this module runs under plain Node (via `node scripts/perf/measure.ts`), which
// does not resolve a specifier that omits its extension the way Vite does.
import { parseFile } from './sql-statements.ts';
import type { ExtractedStatement, UnresolvedStatement } from './sql-statements.ts';
import { captureDynamicStatements } from './sql-dynamic.ts';

/**
 * Instrument 4: `EXPLAIN QUERY PLAN` for every prepared statement this tree's
 * server code holds, checked into a file so a change that turns an index seek
 * into a scan shows up in a diff instead of only in a slow request.
 *
 * Two halves, because this tree writes SQL two ways. A statement written as a
 * literal is read out of the source by `sql-statements.ts`; a statement built
 * by a function is recorded from the running code by `sql-dynamic.ts`, which
 * is the only way to plan the ranked search and the two `food_serving` reads
 * without transcribing them into a second file that drifts. Every call site
 * the parser reports unresolved has to be claimed by a probe or it stays in
 * the report as unresolved, and a probe that claims nothing is an error.
 *
 * `statements.ts` is excluded: it is the `prepared()` cache itself, not a
 * statement. Every `*.spec.ts` is excluded for the same reason `foods.ts`
 * gives about the ETL owning the catalog: a spec's own throwaway schema is not
 * a statement this instrument is answering for.
 */
const SOURCE_DIRECTORIES = [
	'src/lib/server/catalog',
	'src/lib/server/state',
	'src/lib/server/users'
];
const EXCLUDED_FILES = new Set(['statements.ts']);

interface FileStatements {
	file: string;
	statements: ExtractedStatement[];
	unresolved: UnresolvedStatement[];
}

/** Every statement (and every call site this parser could not resolve), one entry per source file. */
async function collectStatements(root: string): Promise<FileStatements[]> {
	const results: FileStatements[] = [];
	for (const directory of SOURCE_DIRECTORIES) {
		const absolute = path.join(root, directory);
		const entries = await readdir(absolute);
		for (const entry of entries.sort()) {
			if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts') || EXCLUDED_FILES.has(entry)) {
				continue;
			}
			const source = await readFile(path.join(absolute, entry), 'utf8');
			const { statements, unresolved } = parseFile(source);
			if (statements.length === 0 && unresolved.length === 0) continue;
			results.push({ file: `${directory}/${entry}`, statements, unresolved });
		}
	}
	return results;
}

interface PlanRow {
	id: number;
	parent: number;
	unused: number;
	detail: string;
}

interface StatementPlan {
	file: string;
	label: string;
	sql: string;
	/** Where the SQL came from: read out of the source, or recorded from the running code. */
	source: 'literal' | 'captured';
	rows: PlanRow[];
}

/** `EXPLAIN QUERY PLAN` for one statement, against whichever connection owns its table. */
function explain(db: DatabaseSync, sql: string): PlanRow[] {
	return db
		.prepare(`explain query plan ${sql}`)
		.all()
		.map((row) => ({
			id: Number(row['id']),
			parent: Number(row['parent']),
			unused: Number(row['notused']),
			detail: String(row['detail'])
		}));
}

/** `src/lib/server/state` and `src/lib/server/users` statements read the application schema. */
function isAppStatement(file: string): boolean {
	return file.startsWith('src/lib/server/state/') || file.startsWith('src/lib/server/users/');
}

export interface PlanResult {
	catalogSource: 'live' | 'fixture';
	plans: StatementPlan[];
	unresolved: (UnresolvedStatement & { file: string })[];
}

/**
 * Plans every extractable statement.
 *
 * Catalog statements run against the live catalog when this machine has one
 * installed, and otherwise against the same in-memory fixture schema the unit
 * specs use (`tests/catalog-fixture.ts`) — same tables and indexes, a dozen
 * rows rather than millions, so an index is still chosen or skipped for the
 * same structural reason even though the planner's row-count estimates are
 * not the production ones. Application statements always run against a fresh
 * in-memory database brought up through the real migration path, so the
 * schema is never hand-duplicated here.
 */
export async function planStatements(root: string): Promise<PlanResult> {
	const files = await collectStatements(root);
	const captured = await captureDynamicStatements(root);
	const claimed = new Set<string>();
	const live = openCatalog(catalogPath());
	const catalogDb = live ?? createFixtureCatalog();
	const appDb = openDatabase(':memory:');
	try {
		const plans: StatementPlan[] = [];
		const unresolved: (UnresolvedStatement & { file: string })[] = [];
		for (const entry of files) {
			const db = isAppStatement(entry.file) ? appDb : catalogDb;
			for (const statement of entry.statements) {
				plans.push({
					file: entry.file,
					label: statement.label,
					sql: statement.sql,
					source: 'literal',
					rows: explain(db, statement.sql)
				});
			}
			for (const item of entry.unresolved) {
				const built = captured.find(
					(each) => each.file === entry.file && each.label === item.label
				);
				if (built === undefined) {
					unresolved.push({ ...item, file: entry.file });
					continue;
				}
				claimed.add(`${built.file} ${built.label}`);
				plans.push({
					file: entry.file,
					label: item.label,
					sql: built.sql,
					source: 'captured',
					rows: explain(db, built.sql)
				});
			}
		}
		const stale = captured.filter((each) => !claimed.has(`${each.file} ${each.label}`));
		if (stale.length > 0) {
			const names = stale.map((each) => `${each.file} — ${each.label}`).join(', ');
			throw new Error(
				`${names}: no such unresolved call site. A probe in sql-dynamic.ts is stale.`
			);
		}
		return { catalogSource: live ? 'live' : 'fixture', plans, unresolved };
	} finally {
		catalogDb.close();
		appDb.close();
	}
}

/** Pure: renders one statement's plan as a markdown section. */
function formatStatement(plan: StatementPlan): string[] {
	const heading = plan.source === 'captured' ? `${plan.label} (built at run time)` : plan.label;
	const lines = [`### ${plan.file} — ${heading}`, '', '```sql', plan.sql.trim(), '```', ''];
	lines.push('Plan:');
	for (const row of plan.rows) lines.push(`- ${row.detail}`);
	lines.push('');
	return lines;
}

/** Pure: the whole report, `plans.md`/`quality/perf-plans.md`. */
export function formatPlans(result: PlanResult): string {
	const lines = [
		'# SQLite query plans',
		'',
		`Catalog statements run against the ${result.catalogSource === 'live' ? 'live catalog file' : 'in-memory fixture schema (`tests/catalog-fixture.ts`) — no catalog file is installed on this machine'}.`,
		'',
		'## Statements',
		'',
		...result.plans.flatMap((plan) => formatStatement(plan))
	];
	if (result.unresolved.length > 0) {
		lines.push('## Not extracted', '');
		for (const item of result.unresolved) {
			lines.push(`- ${item.file} — ${item.label}: \`${item.snippet}\``);
		}
		lines.push('');
	}
	return lines.join('\n');
}
