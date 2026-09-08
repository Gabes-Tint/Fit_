/**
 * The single definition of what mutation testing mutates.
 *
 * It used to live inline in `stryker.config.mjs`, with `mutation-scope.ts`
 * keeping its own hand-copied `FULL_DATA_EXCLUSIONS` beside it. The two drifted
 * the moment either moved: a changed lane passes an explicit file list through
 * `FIT_MUTATION_SCOPE`, which replaces this glob outright, so an exclusion
 * added here was honoured by the full lane and ignored by every changed one.
 * Both now read this file, so there is nothing left to keep in step by hand.
 */

// This gate enforces "reusable logic reaches the mutation score", so the glob
// has to select logic and leave out seed data. A mutant inside a fixture is not
// a defect the tests should catch: killing it would mean asserting the fixture's
// exact contents, which pins wording and sample numbers that are free to change.
// Everything that reads the data — indexes, scaling, macros, the parser, the
// adaptive TDEE model — is still mutated.
// What this glob leaves out is a decision, recorded rather than inherited
// (#76). `.svelte` components, everything under `scripts/` and the end-to-end
// harness under `tests/` are outside every mutation lane, and QUALITY.md, "What
// the mutation lanes do not reach", names what covers each of them instead and
// how thin that cover is in places. `scripts/quality/mutation-scope-ledger.ts`
// keeps the list of those files honest, so a new one cannot join them unnoticed;
// widening this glob is a separate call for the product owner and neither that
// check nor this comment makes it.
//
// Note this include glob is narrower than what actually gets mutated. Every lane
// hands Stryker an explicit file list from `buildMutationScope`, which walks all
// of `src/` and applies only the `!` patterns below -- so `src/routes/**/*.ts`,
// including all nine `+server.ts` handlers, is mutated, and this line governs
// only a bare `stryker run` with no `FIT_MUTATION_SCOPE`. That is why
// `!src/routes/+layout.ts` below is load-bearing and not dead.
export const MUTATE_PATTERNS = [
	'src/lib/**/*.ts',
	'!src/**/*.{test,spec,e2e}.ts',
	// Seed food rows and the provenance label table. Mutants here are food names
	// and label strings.
	'!src/lib/domain/seed-foods.ts',
	// Seed exercise rows, form cues and starter routines. Mutants here are
	// movement names, cue wording and template loads — data, not logic. What
	// reads it (the library index, the group filter, the template copy) is
	// still mutated in exercises.ts.
	'!src/lib/domain/exercise-catalog.ts',
	// Seed recipe rows. Mutants here are recipe names, notes and portions.
	'!src/lib/domain/recipe-book.ts',
	// Demo-journal fixture builder. Its meal templates are data, and the jitter
	// and weight-trend arithmetic exists only to make sample history look
	// lived-in; demo-seed.spec.ts asserts the properties that matter (gaps in the
	// log, varied sources, enough history for adaptive TDEE) without freezing the
	// numbers, and nothing else should.
	'!src/lib/domain/demo-seed.ts',
	// The client exclusions below answer to `scripts/quality/mutation-oracle.ts`,
	// which fails the build if a mutated client file is not reachable from a spec
	// the jsdom project runs. The browser project is not part of a mutation run,
	// so a file that only Chromium can exercise is excluded here on purpose
	// rather than reported as a silent zero.
	//
	// A union of route literals and two Tailwind class tables. There is no logic
	// to mutate: every mutant is a changed utility class, and killing one would
	// mean asserting the exact class string, which pins the styling that these
	// files exist to let move freely.
	'!src/lib/components/nav-routes.ts',
	'!src/lib/components/exercise/sheet-grids.ts',
	'!src/lib/ui/button-variants.ts',
	// Camera capture is canvas encoding: `toDataURL('image/jpeg')`,
	// `image.decode()` and `canvas.captureStream()`. jsdom implements none of
	// them, so camera.svelte.spec.ts has to run in the browser project — and
	// mocking them to move it would delete the behavior under test. That spec
	// covers the scaling closely (each edge, both orientations, the custom
	// limit); what is given up here is mutation coverage of it, not coverage.
	'!src/lib/ui/camera.ts',
	// Two SvelteKit rendering flags. There is no unit to test: what proves them is
	// the build and the end-to-end run, both of which would fail on a flipped
	// value. A changed lane mutated them and reported the pair as uncovered, which
	// said nothing about the tests.
	'!src/routes/+layout.ts',
	// One build-time constant, substituted by Vite's `define` from the git tag.
	// The identifier it re-exports carries no mutant, so the file would be
	// reported as an unmeasurable zero rather than as coverage; the derivation
	// that produces the value is unit-tested in `scripts/build/app-version.spec.ts`,
	// and what proves the substitution is the build, `/api/version`'s spec and the
	// end-to-end run that reads the string off the side navigation.
	'!src/lib/version.ts'
];
