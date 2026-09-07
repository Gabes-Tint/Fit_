/**
 * One type per committed JSON file that more than one script reads, so a
 * fourth field means editing one declaration instead of finding every reader
 * by hand. Each type is named after the file it describes; a script that
 * reads only part of a file narrows with `Pick`/property access rather than
 * declaring its own competing shape for the same JSON.
 */

/** `quality/bundle-budgets.json` — read by `bundle-budget.ts` and `bundle-headroom.ts`. */
export interface BundleBudgets {
	clientCssBytes: number;
	clientJavaScriptBytes: number;
	largestAssetBytes: number;
}

/** `quality/thresholds.json`. */
export interface Thresholds {
	coverage: {
		lines: number;
		functions: number;
		branches: number;
		statements: number;
		perFile: boolean;
	};
	mutation: { break: number; low: number; high: number };
	duplication: { maxClones: number };
}

export interface SearchFixtureQuery {
	query: string;
	group: string;
	means: string;
	acceptable: string[];
	forbidden: string[];
}

/** `data/eval/search-queries.json` — read by `search-eval.ts` and `server-latency.ts`. */
export interface SearchFixture {
	catalog: string;
	limit: number;
	note: string;
	queries: SearchFixtureQuery[];
}
