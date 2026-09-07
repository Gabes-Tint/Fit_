/**
 * The client specs that run without a browser, shared between `vite.config.ts`
 * (which builds the jsdom/browser project split from it) and
 * `scripts/quality/mutation-oracle.ts` (which checks every mutated client file
 * is reachable from it). It lives here rather than in `vite.config.ts` so the
 * oracle can read a ten-line list without executing the SvelteKit, Tailwind and
 * Playwright plugins that config pulls in.
 *
 * The `.svelte.` infix means "this is a client file", not "this needs a DOM",
 * so it used to send every client spec into a headless Chromium. Startup and
 * the Vite transform for that browser land in Stryker's `timeOverheadMS`,
 * which is sampled once in the sequential dry run and then applied as a flat
 * constant to every mutant run — so under N-way contention the specs with the
 * *smallest* net time have the thinnest margin, and a pure string table times
 * out where heavy logic does not.
 *
 * The specs listed here never render or mount a component and never reach for
 * `page`/`locator`/`getBy*`, so a browser buys them nothing. This array is the
 * single source of truth for the split: the browser project excludes exactly
 * what this one includes. A spec that is not listed stays in the browser
 * project — slow but correct — so a new file can never land in jsdom by
 * accident.
 */
export const DOM_FREE_CLIENT_SPECS = [
	'src/lib/auth/api.svelte.spec.ts',
	'src/lib/auth/wording.svelte.spec.ts',
	'src/lib/catalog/barcode-lookup.svelte.spec.ts',
	'src/lib/catalog/food-resolve.svelte.spec.ts',
	'src/lib/catalog/food-search.svelte.spec.ts',
	'src/lib/components/auth/auth-routes.svelte.spec.ts',
	'src/lib/components/exercise/plan-options.svelte.spec.ts',
	'src/lib/components/exercise/routine-tone.svelte.spec.ts',
	'src/lib/photo/photo-log.svelte.spec.ts',
	'src/lib/state/log-ui.svelte.spec.ts',
	'src/lib/state/session.svelte.spec.ts',
	'src/lib/state/sync.svelte.spec.ts',
	'src/lib/state/tend.svelte.spec.ts',
	'src/lib/testing/fixtures.svelte.spec.ts',
	'src/lib/ui/barcode-reader.svelte.spec.ts',
	'src/lib/ui/cn.svelte.spec.ts',
	'src/lib/ui/dictation.svelte.spec.ts',
	'src/lib/ui/download.svelte.spec.ts'
];
