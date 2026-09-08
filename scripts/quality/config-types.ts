/**
 * One type per committed JSON file that more than one script reads, so a
 * fourth field means editing one declaration instead of finding every reader
 * by hand. Each type is named after the file it describes; a script that
 * reads only part of a file narrows with `Pick`/property access rather than
 * declaring its own competing shape for the same JSON.
 */

/** `quality/bundle-budgets.json` — read by `bundle-budget.ts` and `bundle-headroom.ts`. */
export interface BundleBudgets {
	/**
	 * The JavaScript every page loads before it knows which page it is: the
	 * SvelteKit entry, the app shell, the root layout node and their static
	 * imports. Falls when code moves behind a dynamic import; see
	 * `bundle-closure.ts`.
	 */
	alwaysLoadedJavaScriptBytes: number;
	clientCssBytes: number;
	/** Every emitted client chunk summed — a coarse ceiling on total growth. */
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

/**
 * The page-fill block: broad queries that must come back with a full page of
 * distinct foods. They carry no acceptable or forbidden names, because what
 * each one is owed is counted out of the catalog on the run rather than
 * written down here.
 */
export interface SearchFixturePageFill {
	/** The largest page `/api/foods` serves — `MAX_LIMIT` in `foods.ts`. */
	limit: number;
	note: string;
	queries: { query: string; means: string }[];
}

/** `data/eval/search-queries.json` — read by `search-eval.ts` and `server-latency.ts`. */
export interface SearchFixture {
	catalog: string;
	limit: number;
	pageFill: SearchFixturePageFill;
	note: string;
	queries: SearchFixtureQuery[];
}
