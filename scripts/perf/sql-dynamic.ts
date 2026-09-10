import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The half of instrument 4 that a parser cannot do: the statements this tree
 * builds with a function.
 *
 * `sql-statements.ts` reads literals, and two of the catalog's call sites are
 * not literals — `searchSql(FOOD_COLUMNS)` in `foods.ts` and
 * `servingRowsSql(ids.length)` in `serving-rows.ts`. Those are the ranked
 * search and the one read of the 3.5-million-row `food_serving` table: the two
 * statements a plan regression would most likely appear in, and the two the
 * report could not answer for. `portions.ts` was a third until it stopped
 * running a copy of the `food_serving` statement for itself and started
 * reading the map `foods.ts` fetches once per page. Their plans were typed into
 * `quality/perf-plans-manual.md` by hand instead, which made them numbers no
 * command regenerates — and `serving-rows.ts` arrived afterwards (#178) and was
 * never recorded at all, in either file, with nothing to say so.
 *
 * So this does not parse them. It runs them: each call site is reached through
 * the exported function that owns it, on a connection that records the SQL
 * handed to `prepare` and executes nothing. The statement planned is therefore
 * the statement the server builds, by construction, and a change to a builder
 * moves the committed plan in the same commit.
 *
 * Executing nothing is what makes it deterministic and catalog-free: every
 * probe's statement is shaped only by the page size, which is read from the
 * module that owns it rather than typed here, so two machines record the same
 * text. `source-resolver.ts` covers the other half of running real server code
 * under plain `node`.
 */

/** The one method a probe needs. Structural, so the recorder is not a `DatabaseSync`. */
interface Preparing {
	prepare(sql: string): unknown;
}

/** A module namespace, before anything is known about which exports it has. */
export type Loaded = Record<string, unknown>;

export interface CapturedStatement {
	/** The source file, spelled the way `sql-plans.ts` labels one. */
	file: string;
	/** The enclosing function, matching the label `sql-statements.ts` reported unresolved. */
	label: string;
	sql: string;
}

export interface DynamicProbe extends Omit<CapturedStatement, 'sql'> {
	/** Drives the call site named by `file` and `label` for a page of `page` foods. */
	run(loaded: Loaded, db: Preparing, page: number): void;
}

/** The module `pageSize` belongs to; also the first probe's own file. */
const FOODS_MODULE = 'src/lib/server/catalog/foods.ts';

/**
 * A query with matches on any catalog, live or fixture. Only the FTS bind value
 * depends on it — the statement text does not — so it is a keep-the-call-honest
 * input rather than a measurement choice.
 */
const PROBE_QUERY = 'milk';

type SearchFoods = (db: Preparing, typed: string, limit: number) => unknown;
type PageSize = (requested: string | null) => number;
type ServingRowsByFood = (db: Preparing, ids: readonly number[]) => unknown;

/** One named export, checked to be callable so a moved call site fails loudly. */
function callable<T>(loaded: Loaded, name: string): T {
	const value = loaded[name];
	if (typeof value !== 'function') {
		throw new Error(
			`\`${name}\` is not an exported function; a probe names a call site that moved.`
		);
	}
	return value as unknown as T;
}

/** `count` food ids, the shape both `food_serving` readers bind one placeholder each for. */
function idsOfSize(count: number): number[] {
	return Array.from({ length: count }, (_unused, index) => index + 1);
}

/**
 * One probe per call site `sql-statements.ts` reports unresolved. A probe that
 * matches no such call site is an error rather than a no-op, so deleting a
 * dynamic statement deletes its probe instead of leaving a lie behind.
 */
export const DYNAMIC_PROBES: readonly DynamicProbe[] = [
	{
		file: FOODS_MODULE,
		// The ranked search is prepared inside `rankedPage`, which is the name
		// `sql-statements.ts` reports the call site under; `searchFoods` is still
		// what drives it, because the page it asks for is what decides the SQL.
		label: 'rankedPage',
		run: (loaded, db, page) => {
			callable<SearchFoods>(loaded, 'searchFoods')(db, PROBE_QUERY, page);
		}
	},
	{
		file: 'src/lib/server/catalog/serving-rows.ts',
		label: 'servingRowsByFood',
		run: (loaded, db, page) => {
			callable<ServingRowsByFood>(loaded, 'servingRowsByFood')(db, idsOfSize(page));
		}
	}
];

export interface Recorder {
	db: Preparing;
	recorded: string[];
}

/**
 * A connection that answers `prepare` with a statement returning nothing.
 *
 * Nothing is executed, so no catalog is needed and no probe's statement text
 * can depend on how many rows this machine's data happens to hold. The empty
 * answers also stop `searchFoods` reaching its own follow-up reads, which is
 * why each probe records exactly one statement.
 */
export function recordingConnection(): Recorder {
	const recorded: string[] = [];
	const statement = { all: () => [], get: () => undefined, run: () => ({}), iterate: () => [] };
	return {
		recorded,
		db: {
			prepare(sql: string) {
				recorded.push(sql);
				return statement;
			}
		}
	};
}

/** Runs one probe and insists it named exactly one statement. */
export function captureProbe(probe: DynamicProbe, loaded: Loaded, page: number): CapturedStatement {
	const recorder = recordingConnection();
	probe.run(loaded, recorder.db, page);
	const [sql, ...extra] = recorder.recorded;
	if (sql === undefined || extra.length > 0) {
		throw new Error(
			`${probe.file} — ${probe.label} prepared ${recorder.recorded.length} statements, expected 1.`
		);
	}
	return { file: probe.file, label: probe.label, sql: sql.trim() };
}

/** How a module under `src` is loaded; injectable so a spec need not register a loader hook. */
export type LoadModule = (file: string) => Promise<Loaded>;

let registered = false;

/** Imports a repo-relative TypeScript module under plain `node`, aliases and all. */
function nodeLoader(root: string): LoadModule {
	if (!registered) {
		register('./source-resolver.ts', import.meta.url);
		registered = true;
	}
	return async (file) => (await import(pathToFileURL(path.join(root, file)).href)) as Loaded;
}

/**
 * Every function-built statement, as the server builds it.
 *
 * The page size comes from `pageSize(null)` in `foods.ts` — the same default
 * the search endpoint uses — so a change to it moves these plans rather than
 * silently leaving them describing a page nobody asks for.
 */
export async function captureDynamicStatements(
	root: string,
	load: LoadModule = nodeLoader(root)
): Promise<CapturedStatement[]> {
	const foods = await load(FOODS_MODULE);
	const page = callable<PageSize>(foods, 'pageSize')(null);
	const captured: CapturedStatement[] = [];
	for (const probe of DYNAMIC_PROBES) {
		const loaded = probe.file === FOODS_MODULE ? foods : await load(probe.file);
		captured.push(captureProbe(probe, loaded, page));
	}
	return captured;
}
