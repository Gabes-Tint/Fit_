# Client bundle audit

Measured on `main` at `e186b47`, 2026-09-08, with `bun run build` (Vite 8 / Rolldown,
`@sveltejs/adapter-node`) on Node 24. Every number below is either measured on this tree or
labelled as an estimate.

The client JavaScript budget was raised once and blocked a change twice in one day, and nobody
could say what the 425 KB was. This says what it is, what actually reaches a phone, and what
could come out.

## What the budget measures

`bun run check:bundle` runs `scripts/quality/bundle-budget.ts`, which builds fresh (with
`FIT_BUNDLE_MEASURE_VERSION` set — see `scripts/build/bundle-measurement-version.ts`) and then
measures what it just built. It used to measure whatever `.svelte-kit/output/client/_app/immutable`
already held, meaning a stale build could get measured, or the real, variable-length git-derived
`__APP_VERSION__`/`__APP_COMMIT__` could shift the byte count between checkouts; the numbers
below predate that fix and were captured straight after `bun run build`.

Through `scripts/quality/bundle-assets.ts` it walks that directory recursively and, for every
file whose name ends in `.js` or `.css`, takes `stat().size`. Then:

- `clientJavaScriptBytes` — the **sum of every `.js` file**, all 64 of them.
- `clientCssBytes` — the sum of every `.css` file. There is exactly one.
- `largestAssetBytes` — the single biggest file of either kind.

> Since this audit the gate also polices `alwaysLoadedJavaScriptBytes`, the closure argued for
> under "What this says about the budget itself" below. Everything in this section still
> describes `clientJavaScriptBytes`, which is unchanged.

So the JS number is precisely this:

- **Raw bytes on disk.** Not gzip, not brotli. The wire cost is a little over a third of it.
- **The whole tree at once.** All 16 route nodes plus every shared chunk, summed as if one
  visitor downloaded every page of the app in one go. Nobody does. It is not a per-route
  number and not a first-load number.
- **Only `_app/immutable`.** `static/` is excluded, so anything moved out of the bundle into
  `static/` leaves the budget entirely rather than being counted somewhere else.
- **Client only.** The `adapter-node` server build is not counted at all.
- **JS and CSS kept apart.** CSS has its own budget and never affects the JS one.

Current state against `quality/bundle-budgets.json`:

| Metric        | Measured                | Budget  | Headroom |
| ------------- | ----------------------- | ------- | -------- |
| Client JS     | 424,685                 | 425,000 | 315      |
| Client CSS    | 52,273                  | 53,200  | 927      |
| Largest asset | 75,036 (`nodes/0.*.js`) | 83,120  | 8,084    |

### The number is not reproducible, and it is biased against every branch

_Historical: both sources of noise below were eliminated after this audit was written — #321 made `check:bundle` version-length-independent and #326 pinned `kit.version.name` so the token no longer varies. `check:bundle` now measures the same tree byte-for-byte on any machine; see QUALITY.md's bundle section for the current mechanics._

Two things moved the total without a line of source changing, at the time of this audit.

**Random build noise, four bytes.** Repeated builds of one identical clean tree alternate between
two totals four bytes apart. Diffing two such outputs, exactly one chunk differs, and only in the
SvelteKit namespace token it embeds — `globalThis.__sveltekit_<token>`, where the token is a
random base-36 string appearing four times. A six-character token gives one total, a
seven-character token gives that total plus four. Nine builds during this audit produced exactly
those two values and nothing else.

**A systematic eight-byte penalty on every branch.** The build stamps its version into the client
bundle through `__APP_VERSION__`, and `scripts/build/app-version.ts` derives that from git: a
commit sitting exactly on its tag gets `v0.0.64`, and anything ahead of the tag gets
`v0.0.64+<short sha>` — eight characters longer.

`main` is tagged on every merge by `.github/workflows/version-tag.yml`, so a build of clean `main`
always gets the short form and a branch never does. **Every pull request is therefore measured
against a baseline eight bytes smaller than any branch build can be**, and eight bytes of every
reported delta belong to the tag suffix rather than to the change.

Measured on this machine, same `node_modules`:

| Tree                                  | Version stamped   | Total             |
| ------------------------------------- | ----------------- | ----------------- |
| `main` at `e186b47`, on tag `v0.0.64` | `v0.0.64`         | 424,685 / 424,689 |
| this audit branch, one commit ahead   | `v0.0.64+ca3efb4` | 424,693 / 424,697 |
| PR #219's head `953c2e3`              | `v0.0.63+953c2e3` | 425,246           |

So the gate's practical resolution is about ten bytes and its zero point depends on whether the
commit is tagged. That does not rescue PR #219, which is 246 bytes over — but it does mean a
change measured in single-digit bytes is measuring nothing, and that every branch starts eight
bytes in the hole.

## What a person actually downloads

The budget's 424,685 is the whole tree. Resolving the Vite manifest's static import graph gives
what a browser fetches for one page.

| What                                           | Files | Raw     | gzip -9 | brotli -q11 |
| ---------------------------------------------- | ----- | ------- | ------- | ----------- |
| Everything the budget counts                   | 64    | 424,685 | 161,193 | 143,241     |
| Loaded on **every** page (shell + root layout) | 31    | 290,363 | 104,661 | 93,264      |
| Home page first load                           | 37    | 312,188 | 114,229 | 101,822     |
| `/you` first load                              | 35    | 310,519 | 112,783 | 100,486     |

Two things follow.

**Route splitting is buying almost nothing.** 290,363 bytes — 68.4% of the entire JS budget —
load on every single page, because the root layout drags in the toast library, the log sheet,
the photo capture and barcode paths, the sync client and the whole `tend` store chunk. Visiting
the home page adds 21,825 bytes on top of that; the 15 route chunks between them account for
134,322 bytes, under a third of the budget.

**The CSS is one file.** All 52,273 bytes (10,306 gzipped) load on every page.

## Composition

### Method

Two independent measurements, because neither is perfect on its own.

**Source-map attribution (primary).** Built with `vite build --sourcemap`, decoded each chunk's
VLQ mappings, and credited the generated bytes between one mapping segment and the next to the
source file that segment names. Its total comes to **424,685 — exactly the gate's number**, so
nothing is double-counted or dropped. These are post-minification bytes, which is what the
budget counts.

Its weakness is per-file slop. The minifier drops mappings inside a module, so a stretch of
generated code can be credited to whichever source the last surviving segment named.
`src/lib/ui/download.ts` is 518 bytes of source but is credited 3,806 — probing that span shows
about 250 bytes of the real `download()` function followed by compiled template code from
`src/routes/you/+page.svelte`, its importer. Group-level and package-level totals are sound
because module boundaries survive; individual small files can absorb a neighbor.

**Rolldown `renderedLength` (cross-check).** A throwaway Vite plugin recorded every module's
`renderedLength` from `generateBundle`. That is pre-minification, so it totals 861,671 for the
same tree — useful only for confirming the ranking, which it does.

### Where the 424,685 bytes are

Source-map method. Totals to the gate's number exactly.

| Group                                    | Bytes  | Share | Cross-check (pre-min.) |
| ---------------------------------------- | ------ | ----- | ---------------------- |
| `src/lib/components`                     | 87,281 | 20.6% | 191,652                |
| Svelte runtime                           | 56,181 | 13.2% | 179,506                |
| `src/lib/domain`                         | 52,951 | 12.5% | 85,115                 |
| bits-ui                                  | 36,651 | 8.6%  | 77,604                 |
| `src/routes`                             | 30,852 | 7.3%  | 77,226                 |
| Chunk glue, unattributed                 | 30,292 | 7.1%  | n/a                    |
| SvelteKit runtime                        | 27,917 | 6.6%  | 65,430                 |
| svelte-sonner                            | 24,995 | 5.9%  | 61,341                 |
| `src/lib/ui`                             | 19,253 | 4.5%  | 23,214                 |
| `src/lib/state`                          | 13,666 | 3.2%  | 21,131                 |
| @lucide/svelte                           | 12,323 | 2.9%  | 18,771                 |
| `src/lib` (auth, catalog, photo, assets) | 10,534 | 2.5%  | 12,691                 |
| svelte-toolbelt                          | 6,286  | 1.5%  | part of 24,095         |
| tabbable                                 | 5,670  | 1.3%  | 12,855                 |
| SvelteKit generated modules              | 5,709  | 1.3%  | 10,507                 |
| inline-style-parser                      | 1,550  | 0.4%  | part of 24,095         |
| runed (two copies)                       | 1,897  | 0.4%  | part of 24,095         |
| clsx                                     | 363    | 0.1%  | 533                    |
| style-to-object                          | 210    | 0.0%  | part of 24,095         |
| No source map (two stub files)           | 104    | 0.0%  | n/a                    |

Rolled up: **our own code 214,537 (50.5%)**, **dependencies 174,043 (41.0%)**, chunk glue and
SvelteKit-generated modules 36,105 (8.5%).

Third-party, by package:

| Package                                         | Bytes  |
| ----------------------------------------------- | ------ |
| svelte                                          | 56,181 |
| bits-ui                                         | 36,651 |
| @sveltejs/kit                                   | 27,917 |
| svelte-sonner                                   | 24,995 |
| @lucide/svelte                                  | 12,323 |
| svelte-toolbelt                                 | 6,286  |
| tabbable                                        | 5,670  |
| inline-style-parser                             | 1,550  |
| runed                                           | 1,111  |
| runed (second copy, nested under svelte-sonner) | 786    |
| clsx                                            | 363    |
| style-to-object                                 | 210    |

### Largest single modules

Per-file slop applies; treat these as ranked, not exact.

| Bytes  | Module                                           |
| ------ | ------------------------------------------------ |
| 18,519 | `@sveltejs/kit/src/runtime/client/client.js`     |
| 11,093 | `svelte-sonner/dist/Toast.svelte`                |
| 10,027 | `src/lib/domain/seed-foods.ts`                   |
| 7,674  | `src/routes/you/+page.svelte`                    |
| 7,049  | `svelte-sonner/dist/Toaster.svelte`              |
| 6,929  | `src/lib/state/tend.svelte.ts`                   |
| 5,926  | `src/lib/components/Onboarding.svelte`           |
| 5,914  | `bits-ui/dist/bits/dialog/dialog.svelte.js`      |
| 5,879  | `src/lib/components/LogSheet.svelte`             |
| 5,670  | `tabbable/dist/index.esm.js`                     |
| 5,591  | `src/lib/domain/exercise-catalog.ts`             |
| 5,430  | `svelte/src/internal/client/reactivity/batch.js` |
| 5,260  | `src/lib/domain/recipe-book.ts`                  |
| 5,045  | `src/lib/state/sync.svelte.ts`                   |

There is no single dominant item. The two biggest contributors after the frameworks are a UI
library used for one primitive and a data table.

## Shipped to the client that need not be

The good news first, since these are the usual suspects and all of them come back clean:

- **No server code leaks.** Zero bytes from `src/lib/server/**` or `src/lib/testing/**` reach
  the client bundle.
- **No barrel imports.** All 29 Lucide icons are imported per-icon
  (`@lucide/svelte/icons/<name>`); there is no `from '@lucide/svelte'` anywhere in `src`. The
  12,323 bytes are 33 icon modules plus the shared `Icon.svelte`, which is what 29 icons cost.
- **No polyfills, no dev-only code.** No `core-js`, no regenerator, no `import.meta.env`
  branches, no stray `console.log` — the only console calls in the bundle are six `console.warn`
  and two `console.error` inside Svelte and bits-ui.

What is genuinely there and need not be:

**The favicon is inlined into the JavaScript.** `src/routes/+layout.svelte` does
`import favicon from '$lib/assets/favicon.svg'`, and Vite embeds the 1,569-byte SVG as a base64
data URI inside the root layout chunk — 2,125 bytes of JS, on the largest asset, on every page.

**`runed` ships twice.** bits-ui depends on `runed@^0.35.1` and svelte-sonner on `runed@^0.28.0`,
so bun installs 0.35.1 at the top level and 0.28.0 nested under svelte-sonner. Four modules
(`context.js`, `active-element.svelte.js`, `configurable-globals.js`, `internal/utils/dom.js`)
ship in both copies: 786 duplicated bytes.

**svelte-sonner is 25 KB of JS and 14 KB of CSS for `toast('a string')`.** All 20 call sites in
`src` pass a plain string; there is no `toast.success`, `.error`, `.promise`, `.custom` or
`.loading`, no action buttons and no rich content anywhere. `<Toaster>` is given `position` and
two offsets. Everything else the library carries — swipe-to-dismiss, stacking and expansion
animation, promise lifecycle states, four icon variants, theming, and a stylesheet that is 27%
of the entire CSS budget — is unused surface.

**`seed-foods.ts` is 10,027 bytes of nutrition data in an always-loaded chunk.** 49 hand-written
rows, read by `demo-seed.ts` (the sample journal) and `recipe-book.ts`. It is deliberate — its
own doc comment explains that since #146 nothing searches it and every food a person can find,
scan or type comes from the server catalog. It is still the third-largest module in the bundle
and it loads on every page including `/signin`.

## What PR #219 cost, and why

PR #219 factors the day-strip shell shared by `WeekStrip` and `TrainingWeekStrip` into one
`DayStrip.svelte`, and the bundle grows 561 bytes. Building both trees with source maps and
diffing the attribution shows every byte of it:

| Delta    | Before  | After   | Source                                                 |
| -------- | ------- | ------- | ------------------------------------------------------ |
| +613     | 0       | 613     | `src/lib/components/DayStrip.svelte` (new)             |
| −381     | 3,195   | 2,814   | `src/lib/components/WeekStrip.svelte`                  |
| +306     | 30,292  | 30,598  | chunk glue (unattributed)                              |
| +141     | 0       | 141     | `src/lib/components/day-strip.ts` (new)                |
| −94      | 713     | 619     | `src/lib/domain/week-strip.ts`                         |
| +46      | 1,949   | 1,995   | `src/lib/components/exercise/TrainingWeekStrip.svelte` |
| +8       | 403     | 411     | `src/lib/version.ts` — the tag suffix, not the change  |
| −78      | —       | —       | eleven other modules, chunk reshuffling                |
| **+561** | 424,685 | 425,246 | total                                                  |

Eight of those bytes are the branch-versus-tag penalty described above and have nothing to do
with the refactor, so **the change itself costs 553 bytes**.

Three things went wrong at once, and the module boundary is the smallest of them.

**A new shared chunk was created.** On `main` the strip code lives inside the route chunks:
`WeekStrip` in `nodes/2` (home), `TrainingWeekStrip` in `nodes/3` (exercise). After the refactor
both route chunks import the shared component, so Rolldown hoists it into a new
`chunks/*.js` of 1,574 bytes holding three modules totalling 1,373 — **201 bytes of import and
export preamble that did not exist before**, plus the import statements each consumer gained.
That is most of the +306 glue row. A shared module used by exactly two routes pays for a third
file.

**The generic shell is bigger than the code it replaced.** `DayStrip.svelte` at 613 bytes is
larger than the 381 `WeekStrip` shed. Being generic costs: `$props()` destructuring with two
computed defaults (`today = todayISO()`, `days = dayStripRange(today)`), a `CellProps` object
literal built per cell per render, and two closures (`attach`, `onkeydown`) allocated inside the
`{#each}` for every cell. Inlined in one component none of that existed — the range was a local,
the element reference was a direct `bind:this`, and the keydown handler was one function shared
by the whole loop rather than one closure per cell.

**Snippet indirection is not free either.** What the two strips do not share — each cell's own
markup and its interactive element — now crosses the boundary as `Snippet<[CellProps]>`. The
consumer's per-cell markup is not deleted; it is wrapped. Svelte compiles a snippet to its own
function with its own template, and `{@render children({...})}` is a call through a prop, where
before the markup sat inline in the `{#each}` body. `WeekStrip` therefore only shed the scroll
container, the auto-center effect and the roving-tabindex handler — 381 bytes — while keeping
everything else.

**And `TrainingWeekStrip` grew rather than shrank**, by 46 bytes, because the same PR extends it
from one week to the 38-day range with new labels. Its deduplication saving and its new feature
roughly cancel. So the +553 is not purely the price of removing duplication either, and a
version of this PR that only deduplicated would land somewhere near +500.

The honest summary: the extraction created 955 bytes of new shared code and chunk overhead to
remove 475. Sharing about forty lines of scroll-and-keyboard logic between two components does
not pay for itself in bytes. It may still be the right change — one place to fix a bug is worth
something the budget cannot see — but the budget is the wrong instrument for judging it.

## Reduction opportunities

Ranked by bytes per unit of risk. "Measured" means the change was made on this tree, built, and
`check:bundle` read; "estimated" means it was not.

### 1. Replace svelte-sonner with an in-house toast — measured ceiling −26,744 JS, −14,141 CSS

Aliasing `svelte-sonner` to a stub with a no-op `toast()` and an empty `<Toaster>` gives 397,941
JS bytes (from 424,685), 38,132 CSS bytes (from 52,273) and a largest asset of 55,250 (from
75,036). A real replacement is not free — a fixed-position list, a timeout and a fade is perhaps
1.5–2 KB of ours — so the realistic net is around **−24,000 JS and −13,000 CSS**, an estimate
bracketed by a measurement.

Risk: **low to medium**. Low because the entire used API is `toast(string)` at 20 call sites
plus three props on `<Toaster>`; there is no feature to port. Medium because it is a visible
component and the replacement has to keep the top-center placement, the safe-area offset
`AppShell` computes below the notch (there is no top bar left to clear), and whatever the
accessibility checks in the e2e suite assert about it.

Touches behavior: **yes, visually.** Swipe-to-dismiss, stacking and the expand-on-hover
animation would go. Nothing about what the app does or stores changes.

This is far and away the best trade available: it alone is 5.7% of the JS budget and 25% of the
CSS budget, and it takes the largest asset from 75,036 to 55,250 in the process.

### 2. Serve the favicon from `static/` — measured −2,125 JS

Copying `favicon.svg` into `static/` and pointing `<link rel="icon">` at its URL instead of
importing it gives 422,560 JS bytes and a largest asset of 72,911.

Risk: **very low.** No code depends on it.

Touches behavior: **marginally.** The icon becomes one more request instead of an inline data
URI, and files in `static/` are not content-hashed, so a future icon change needs a cache-busting
thought that the current setup does not. Worth naming, not worth much.

Note that 2,125 bytes is nearly four times what PR #219 costs.

### 3. Collapse `runed` to one copy — measured −819 JS

Removing the nested `runed@0.28.0` so svelte-sonner resolves the top-level 0.35.1 gives 423,866
JS bytes, and the build succeeds.

Risk: **medium**, and higher than the bytes justify. It needs a `runed` entry in the `overrides`
block, which changes `bun.lock` and so is a deliberately reviewed change; and it forces
svelte-sonner onto a major-minor its author did not declare support for. Compiling is not the
same as working.

Touches behavior: **potentially**, in a way that is hard to test for.

This one is subsumed by opportunity 1 — dropping svelte-sonner removes the nested copy along
with it, and those 786 bytes are already inside that 26,744.

### 4. Replace the bits-ui `Dialog` with the platform `<dialog>` element — estimated −45,000 to −51,000 JS

bits-ui is used for exactly three primitives: `Dialog` (behind `src/lib/ui/Sheet.svelte` and
`Modal.svelte`), `Switch` and `Checkbox`. `Dialog` is the expensive one: it pulls
`dialog.svelte.js` (5,914), the dismissible-layer, focus-scope, escape-layer and
text-selection-layer utilities, body-scroll-lock, the presence manager, and through focus-scope
the whole of `tabbable` (5,670).

Estimated as the sum of what would become unreachable — bits-ui 36,651, tabbable 5,670,
svelte-toolbelt 6,286, inline-style-parser 1,550, runed 1,111, style-to-object 210 — less
perhaps 3,000 bytes of replacement code, and less whatever `Switch` and `Checkbox` still need.
**This is an estimate and was not measured**; the accurate way to get the number is to build the
replacement.

Risk: **high.** Focus trapping, scroll lock on the body, dismissal on Escape and on outside
click, portal rendering and the `data-state` hooks the animations use are all real behavior that
`<dialog>` gives only partly. The axe checks in the Playwright suite are asserting on it.

Touches behavior: **yes**, including accessibility behavior.

### 5. Move the sample-journal food data behind the server catalog — estimated −10,000 JS

`seed-foods.ts` is 10,027 bytes in a chunk that loads on every page.

Risk: **this is a product decision, not a maintenance one.** The 49 rows are what makes the
sample journal and the recipe book work without a network. Fetching them turns first run into a
network-dependent flow. That is Gabriel's call, and it should not be made for 10 KB of a metric
that does not measure what a phone downloads.

### 6. Do not split the log sheet out of the root layout — measured +2,109 JS, and it fails the gate

Included because it is the most instructive measurement here, not because it is an opportunity.

`LogSheet` and its dependencies (`PhotoCapture`, `BarcodeScan`, the camera and photo-log
helpers) sit in the root layout, so they load on every page even though the sheet opens only
when someone taps Log. Replacing `<LogSheet />` with `{#await import('./LogSheet.svelte')}`
takes the root layout chunk from **75,036 to 42,661 bytes — a 43% cut to the code every page
loads**, the single largest real-world improvement available.

`check:bundle` fails it: 426,794 bytes, 1,794 over budget, because the new chunk boundaries add
2,109 bytes to the tree total.

## What this says about the budget itself

The gate cannot tell "we shipped more code" apart from "we split code better", and it scores the
second one as a regression. The two most useful things anyone could do to this app's load time —
lazily loading the log sheet, lazily loading onboarding — both make the number worse. Meanwhile
68.4% of the budget loads on every page and the metric is indifferent to that.

Two ways to fix the instrument, both a decision rather than a fix:

- Budget the **always-loaded closure** (the SvelteKit entry plus the root layout node and their
  static imports: 290,363 at the time of this audit) instead of the tree total. That number goes
  down when code is split and up when code is added, which is the direction it should point.
- Or keep the tree total as a coarse ceiling and add a second, tighter budget on that closure,
  so splitting is rewarded by one metric and total growth is still caught by the other.

Either way the budget should be a round headroom above where the tree sits, not 315 bytes above
it: at 315 bytes of headroom, against a metric with a ten-byte resolution and an eight-byte
penalty on every branch, the gate is measuring the build as often as it is measuring the code.

### What was done about it

The second one, on 2026-09-08. `scripts/quality/bundle-closure.ts` resolves the closure from the
client build's own Vite manifest — the shell entries plus the `nodes/0` root layout, then static
`imports` transitively, never `dynamicImports` and never a chunk name, which is content-hashed
and changes every build — and `check:bundle` budgets it as `alwaysLoadedJavaScriptBytes`
alongside the tree total. Splitting `LogSheet` out of the root layout now shows up as the large
improvement it is on one metric while the other still catches the 2,109 bytes it adds to the
tree.

Every budget was re-cut off a fresh measurement at the same time, because opportunities 1 and 2
— the in-house toast and the static favicon — had both landed by then and the old numbers no
longer described anything. Measured on this branch with a clean `bun run build`: tree total
**399,373**, closure **264,268** across 32 of 66 chunks (66%), CSS **38,750**, largest asset
**55,250**.

| Budget                        | Was     | Now     | Measured | Headroom      |
| ----------------------------- | ------- | ------- | -------- | ------------- |
| `clientJavaScriptBytes`       | 425,000 | 410,000 | 399,373  | 10,627 (2.7%) |
| `alwaysLoadedJavaScriptBytes` | —       | 270,000 | 264,268  | 5,732 (2.2%)  |
| `clientCssBytes`              | 53,200  | 40,000  | 38,750   | 1,250 (3.2%)  |
| `largestAssetBytes`           | 83,120  | 57,000  | 55,250   | 1,750 (3.2%)  |

A couple of percent is the principle: enough that a change worth arguing about is what trips the
gate, rather than the twelve bytes of build noise documented above, and enough that the
`LogSheet` split — which adds 2,109 bytes to the tree while cutting the closure hard — can
actually land. `check:bundle` now prints that eight-byte and four-byte noise with every failure,
so the next person to miss by a hair does not go looking for it in the diff.

### `clientJavaScriptBytes` raised once more, on 2026-09-08, to buy the split above

Opportunity 6 stopped being hypothetical: #158 needed 3,540 bytes of a closure that had
126 left, so `AppShell` now fetches the log sheet after the shell instead of inside it.
Measured on that branch against `main` at `5da6cc3`, both with a clean `bun run build`:

| Metric                        | `main`  | With the split | Budget            |
| ----------------------------- | ------- | -------------- | ----------------- |
| `alwaysLoadedJavaScriptBytes` | 269,896 | **224,389**    | 270,000           |
| `clientJavaScriptBytes`       | 405,768 | **411,980**    | 410,000 → 421,000 |
| `clientCssBytes`              | 38,888  | 38,888         | 40,000            |
| `largestAssetBytes`           | 55,535  | 56,038         | 57,000            |

What every page downloads falls 45,507 bytes, 16.9%, and the root layout node with it,
from 55,535 to 19,485. The tree total rises 6,212 — 3,956 of feature and 2,256 of the
chunk-boundary cost section 6 measured at 2,109 — which is what put it over.

Only `clientJavaScriptBytes` moved, and by the calibration this section already used
rather than by enough to clear the build: the measured 411,980 plus the smallest
proportional headroom the other three carry, which is `alwaysLoadedJavaScriptBytes`'s
2.17% (the mean of the three is 2.85%, and would have given 424,000). That is 420,915,
rounded up to **421,000** — 9,020 of headroom, 2.19%. The other three budgets were left
where they were calibrated, because the same build comes in under all of them.

`largestAssetBytes` moved on the same principle rather than being left as a follow-up. Dropping
svelte-sonner took the biggest file from 75,036 to 55,250 while the budget stayed at 83,120, and
a budget that cannot fire is the same defect as one that fires on noise — which is the whole
subject of this section. The first reservation was that the largest file's _identity_ is decided
by chunk boundaries, which move in kilobytes; measurement answers it. The largest asset is a
shared chunk at 55,250 and the runner-up is `nodes/0` at 51,294, a 3,956-byte gap, so a
byte-level budget on it is not sitting on a coin flip.

## Reproducing this

```bash
bun run build
bun run check:bundle          # the gate's own number
bun run bundle:headroom       # the same number plus headroom, and --against <ref> for a delta
```

For the composition, build with `bunx vite build --sourcemap` and attribute each chunk's bytes
through its `.js.map`. For the cross-check, add a Vite plugin that records
`chunk.modules[id].renderedLength` in `generateBundle` — note that SvelteKit runs two builds and
loads the config twice, so the plugin must write one file per build or the client numbers are
overwritten by the server ones.
