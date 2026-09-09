# Fit_ quality system

Fit_ is developed primarily by AI agents, so its quality system exists to reject common
forms of low-quality generated code with repeatable evidence before a change can merge.
The gates are deliberately built before the features they will police, because an agent
has no incentive to add, after the fact, a check that fails its own output.

`README.md` has setup and commands. `AGENTS.md` has the rules agents must follow. This
file records what is already settled, so it is not re-argued, and what is deliberately
missing, so it is not proposed again.

## Standing rules

- **The bar is met, not moved.** Thresholds only ratchet upward, suppressions require a
  recorded justification, and every gate must prove through a self-test fixture that it
  rejects what it claims to reject. A gate without a fixture is unfinished work.
- **Gates are reviewable, not sacred.** If a gate is observed pushing agents toward filler
  work — tests written to satisfy a coverage number rather than to catch a defect — the
  answer is an open review of that gate, recorded here, never a silent workaround.
  Mutation testing exists to catch assertion-free filler: a test that kills no mutants
  already fails the gate that matters.
- **Only deterministic gates block a merge.** Checks whose findings change without a code
  change — Trivy's vulnerability feed, ZAP's observation of live traffic — run on a
  schedule and never gate. Do not promote them.
- Passing tools cannot prove a feature satisfies its requirement. Acceptance criteria and
  regression tests remain the primary evidence of behavioral correctness.
- **Every shape change to the state document ships with its migration.** `TendState` is one
  JSON document shared by every device on the account, and no two devices run the same build
  — the browser has whatever was last deployed, the phone has whatever Android last
  installed. So adding, removing or retyping a field means, in the same pull request:
  bump `SCHEMA_VERSION` in `src/lib/domain/state-document.ts`, append a pure
  `migrate_N_to_N+1` to `MIGRATIONS` that carries the old shape to the new one, extend
  `FIELD_CHECKS`, and test the upgrade against a fixture of the old document. `FIELD_CHECKS`
  is typed against the document, so half of that is a compile error rather than a review
  note. A migration reads no clock, no random source and no storage: same document in, same
  document out, every time. A document older than the build is migrated forward; one newer
  is refused, never merged and never written over, because an old build cannot know what a
  new field means and the only safe thing it can do is leave the data alone and say so.

## Settled: do not propose additions here

Formatting, type safety, type-aware lint, Svelte diagnostics, test discipline, dead code,
duplication and complexity caps, secret scanning, SAST, bundle budgets, the production
build, workflow lint, report retention and branch protection are enforced and considered
done.

## Slop audit

A recurring pass (#129) removes what the gates cannot see: a test that cannot fail for a
reason anyone cares about — it asserts a constant, mirrors the implementation, mocks the
unit under test, or exists only to move coverage; a wrapper with one caller that adds no
name, no type narrowing and no boundary; dead indirection such as a single-key config
object, a `$derived` that copies a prop, a `{@const}` used once, or a re-export nobody
imports; two formatters of the same thing; and a comment that restates the code or, worse,
describes code that no longer exists. Not slop: a test that kills a mutant, a boundary at
the auth or server edge, and a domain explanation a reader needs.

The bar is the same as for any other change here — **the finding is not the proof.** A test
is only useless if deleting it leaves the owning file's _killed_ count unchanged: run the
lane on the file before and after and quote both numbers. A wrapper is only needless if
inlining it leaves `check`, `lint` and `knip` clean with no behavior test touched. And a
comment is only wrong once it has been read against the code, because the fix for a wrong
comment is a correct sentence, not a deletion — the first pass found one that described a
`NaN` guard `portions.ts` did not have, which was a defect and not a comment problem at all.

One pass is one directory or lane, so the pull request stays reviewable, and each finding
is a row in its table: what, why it is slop, and the proof. Whole-file mutation strict
applies as everywhere else, and it decides what a pass may touch: a file already carrying
survivors, uncovered mutants or a timeout cannot be edited without paying that debt first,
so a pass leaves it alone and says so rather than dragging the lane red behind it.

## Gate operation

Every tier runs to completion rather than stopping at the first failure, and writes
`reports/quality/gate-<tier>.json` listing each step, its exit code, its log path and its
machine-readable artifact. `README.md` has the tier table; `make` lists local shortcuts for
the same tiers.

**A gate that did not run is not a gate that failed.** Exit 1 is a verdict about the change;
a runner that died before measuring anything exits 97 instead, and `scripts/quality/run-outcome.ts`
is the one definition of that contract. The gate report files such a step under `crashed`
rather than `failed` and marks its `outcome`, and a tier whose only red steps crashed exits
97 itself. This is reporting, not tolerance: a crash is still red, still blocks, and is never
a threshold to relax. It cost half an hour once, when a mutation lane whose Stryker dry run
died left an empty report directory and exit 1, and was read as surviving mutants.

`make ci` runs the exact steps the CI workflow runs, but arranges them for one machine
instead of separate hosted runners: the static and security jobs run beside the browser
gates, and mutation testing gets the machine to itself afterwards. It cannot be reordered
freely — `build`, `test:e2e` and `test:gates` all contend for `build/` and for the preview
port block that starts at 4173, one port per Playwright worker.

**Where a tier runs is a cost decision, and the default is the hosted runners.** Measured
2026-09-04 (run 33918527511): the hosted `ci` workflow finishes in about four and a half
minutes across fourteen parallel jobs, while the same suite run locally through `make ci`
takes eight to eighteen minutes because one machine runs the lanes in sequence. Running both is paying twice for one answer, and
the local half is the expensive one: an agent waiting on it is billing tokens to poll a
process that a hosted runner is about to repeat for free.

So the rule is: run a diff-sized set of checks before pushing, not a full tier — see
"Pre-push" below for the exact recipe — then push and let the hosted matrix run the full
tier. Read the verdict from `gh pr checks`, not from a local report. Two exceptions stay
local: the deploy scripts, which need the real machine, and tight iteration on one failing
lane, where `gate.ts ci --job <name>` beats a four-and-a-half-minute round trip.

**`bun run verify:changed`** sizes a gate run to the diff instead of guessing a tier:
static checks always, plus only the specs, the route or component end-to-end files, the
mutation lane, and the build whose inputs the diff actually touches (`git diff
<base>...HEAD` against `origin/main` by default, `--base <ref>` to override, `--dry-run`
to print the plan without running it). It is the default run for an agent whose brief
names no tier.

This changes where the gates run, never what they enforce. Every threshold, every lane and
every fixture is unchanged, and a red hosted check blocks a merge exactly as a red local
one did. The trade accepted deliberately is that a mutation or end-to-end failure is caught
after the push rather than before it; since a local full run costs more wall clock than the
hosted one, that costs no time, only the tidiness of never pushing red.

### Pre-push

`bun run lint:changed` (issue #128) lints only what a push would actually add: files
committed since `HEAD` diverged from `origin/main`, plus whatever is staged or sitting
unstaged right now, filtered to the extensions `eslint.config.js` actually covers (`.ts`,
`.svelte`, `.js`, `.mjs`). `--base <ref>` overrides the merge-base target the same way
`verify:changed`'s does; an empty match prints `lint: nothing to lint.` and exits 0 rather
than skipping silently. `lint:staged` is its staged-only sibling — the pre-commit hook's
view, since a commit only ever captures the index. Both are one mode inside
`scripts/quality/eslint.ts` (`--changed` / `--staged`), reusing the same ESLint invocation,
concurrency and memory-budget code the full `lint` script runs — `scripts/quality/changed-files.ts`
is the one place staged/unstaged/committed-since-merge-base file selection is computed, and
`verify:changed.ts`'s own `lint` step now calls `lint:changed` against the same merge-base
instead of re-linting the whole tree on top of what CI already re-lints for the full diff.

The pre-commit hook (`bun run precommit`, wired in by `git config core.hooksPath .githooks`)
used to run full `lint` on every commit — a type-aware pass over the whole tree, ~75s and up
to 9GB resident. It now runs `format:check` and `check:suppressions` unscoped (both cheap:
`format:check` is Prettier with its own file cache and was already near-instant on a warm
one) plus `lint:staged` in place of full `lint`. Measured on a one-line comment-only change,
staged and committed: **before, 76.5s** (`lint` alone took 75.3s of that); **after, 6.3s**.

Before pushing, run this recipe — every command in the foreground with a long timeout;
never `run_in_background`, never `Monitor` against these, since the harness can't tell a
gate that hung from one that is just slow that way:

- `npm run check`
- `npm run lint:changed`
- the unit/component specs for the files actually touched, e.g. `bunx vitest run
src/lib/domain/tdee.spec.ts`
- the affected `*.e2e.ts` file once, on one project: `E2E_PROJECT=mobile-chrome bunx
playwright test src/routes/today/today.e2e.ts`
- the mutation lane, only when the touched files sit under `src/lib/domain`,
  `src/lib/server`, or `src/lib/state`: `bun run test:mutation:changed:node` for
  server/domain code, `bun run test:mutation:changed:client` for client-side state

Never run the full end-to-end suite (`test:e2e`, `test:e2e:all`) and never run `verify` or
`verify:deep` locally before a push — CI is the authority on all three, and re-running them
on a workstation only pays wall clock twice for the answer the hosted matrix already gives.
`bun run verify:changed` already automates this exact diff-sizing in one command and is the
preferred way to run it; the bulleted recipe above is what that command does internally,
spelled out for a brief that needs the pieces named.

`check:ci-contract` proves every declared local CI slice is hosted and every hosted gate job
is listed in `all-green.needs`; a job outside that protected aggregator is not a merge gate.

Since #167 it also proves the setup the jobs stopped pasting. The five preamble steps live in
`.github/actions/setup` and the report uploads in `.github/actions/upload-report`, which is
the shape that can hollow a workflow check out: a job with no toolchain in it reads exactly
like a job with one. So the guarantee is asserted in halves that only hold together — every
job running Bun calls the setup action; that action still pins Node and Bun to
`.tool-versions`, restores the Bun cache and installs `--frozen-lockfile`; the upload action
still names each artifact after the run and attempt and keeps it three days; and every
upload is still gated on `if: always()` at the call site, because a condition inside a
composite action cannot resurrect a step the job already skipped, and a gate that failed
would otherwise upload no evidence at all. And every job that calls a local action still
checks the repository out, because a composite action is read from the workspace and cannot
be what puts the workspace there — without it a job fails on "Can't find action", naming the
action rather than the missing checkout. Four fixtures prove those halves — `ci-job-without-setup`,
`gutted-setup-action`, `unconditional-report-upload` and `ci-job-without-checkout`.

It also proves the workflow answers the merge queue. Branch protection requires one check,
`Quality and security`, and the queue does not test a pull request — it builds `main` plus
every queued pull request onto a `gh-readonly-queue/…` branch and asks for checks on that
combined tree, which is the only place two separately green pull requests can be caught
being red together. Those requests arrive as `merge_group` events, so a workflow that does
not listen for them reports nothing at all: the required check stays pending and every merge
blocks, with nothing red to explain it. `scripts/quality/merge-queue-trigger.ts` asserts that
the workflow declaring `Quality and security` also declares a `merge_group` trigger, and the
fixture `ci-without-merge-queue-trigger` proves it rejects the one-line deletion that would
look like tidying an event list.

`check:stale-revert` asks the one question no other gate can: not whether this branch is
sound, but whether it is _older than main_. Twice on the same day a branch cut before another
pull request merged carried that pull request's files at their earlier content, and merging it
took the work back out — #230 removed #223 and put a smoke test that registers an account
against production back on every deploy, green before and after its rebase, live on `main` for
an hour and found by accident. A rebase is what hides it: there is no conflict to resolve, and
the reverted lines arrive at review as deliberate deletions.

So for every file the branch changes, and every one of the last 40 commits on `main` that also
changed it, `scripts/quality/stale-revert.ts` asks whether the branch's copy is simply what
main had before that commit: the commit's additions are still intact at the merge base, not
one of them survives in the branch's copy, and the branch has written nothing into that file
that the older copy did not already have. That last condition is what keeps it quiet — a pull
request genuinely reworking those lines writes something new and is never reported. Over the
sixty merges before it was written the rule fired twice: on #230, and on #240, the pull
request that undid #230 on purpose. That second one is the cost, and the way past it is a
`Reverts: <sha>` trailer in one of the branch's own commit messages, which clears findings
against that commit and nothing else — a claim about one named commit, in the history where
review reads it, not a switch that turns the check off. The fixture
`branch-reverting-merged-work` builds the three-commit history that reproduces #230's shape,
and `stale-revert.spec.ts` reconstructs the real branch from this repository's own history and
proves all nine files are named.

Branch protection could close the whole class instead, by requiring a branch to be up to date
with `main` before it merges. That is configuration and Gabriel's call, and it costs a rebase
and a CI cycle per merge against a queue that is already the bottleneck; this check costs a
second and catches the same thing after the fact.

`check:schedules` is the same proof for the lanes that deliberately do not gate a merge. A
tier taken off the pull request only exists if a schedule still runs it, so this proves the
`audit` and `nightly` tiers are each invoked by a workflow with a `cron`, and that the
workflow can open an issue about what it found. It also rejects the specific trap a
non-blocking lane walks into: `continue-on-error: true` on every lane means the job always
succeeds, so a reporting step gated on `if: failure()` can never fire and the run is green
with the debt still there. Three fixtures prove the three halves —
`unscheduled-audit-lane`, `silent-scheduled-lane` and `unreachable-schedule-report`.

`bun run check:thresholds` guards the numbers that decide whether a gate passes: coverage,
mutation score, bundle budgets, duplication, and the suppression baseline. Lowering any of
them fails the gate. The suppression ratchet stops a diagnostic being silenced; this stops
the bar being moved instead.

No tier needs Firefox or WebKit. Every gate runs end-to-end flows through the default
`mobile-chrome` project (Pixel 7 viewport, Chromium engine); only `bun run test:e2e:all`
reaches for `mobile-safari` (iPhone 15, WebKit) and desktop Chrome and Firefox, and CI is
where that runs. Fit_ is a mobile web app, so a mobile viewport is the primary target and
desktop is a regression backstop.

`scripts/security/zap.ts` pins the project it proxies. If a project is renamed in
`playwright.config.ts`, that reference has to move with it or the nightly scan fails with no
matching project. `bun run nightly` also needs the Docker bridge to reach the host preview
server; a host firewall that blocks it produces a timeout, not a security verdict, and must
not be read as a passing scan.

Trivy blocks on High and Critical findings. When the fix sits inside the range the parent
already allows, pin it in the `overrides` block of `package.json` and drop the override once
the tree resolves to a patched version by itself. Do not force an override across a major
boundary a direct dependency declares against; record why here instead.

## Duplication scope

`.jscpd.json` ignores `**/*.{test,spec}.ts`, so `bun run duplicates` and its `maxClones: 0`
threshold cover only production code — roughly 37k of the ~56k TS lines in `src` and
`scripts` (measured 2026-09-07). Running the same `minLines`/`minTokens`/`mode` values
without that ignore finds real clones in spec files: 38 clones / 563 duplicated lines, most
of them repeated fixture objects in `mutation-verdict.spec.ts` and repeated setup blocks in
`sync.svelte.spec.ts`. `check:mutation-oracle` and the mutation lanes already give spec
fixtures their own strictness (a spec file that only restates the code it tests fails the
"kills nothing new" check), so the clone ratchet staying narrow to production code is a
scope choice, not a blind spot nobody noticed — but it is worth stating plainly rather than
leaving `bun run duplicates` looking like a whole-tree number when it is not.

Widening `.jscpd.json` to specs is deliberately deferred rather than done alongside this
note: #169 (spec fixture deduplication) is mid-flight on the exact files carrying the worst
of these 38 clones, and recording a baseline or fixing the clones here would either go stale
the moment #169 lands or collide with it file-for-file. Once #169 merges, re-run the wider
scan above, lift the ignore, and set `duplication.maxClones` back to `0` against whatever
remains — the ratchet only moves after the clones are gone, never as the way to make it
pass.

## Bundle budget

`check:bundle` polices four numbers, each answering a question the others cannot. When one
goes red, this is which one you tripped and what it is for:

- **`clientJavaScriptBytes`** — a coarse ceiling on the total amount of code shipped. Every
  emitted client chunk summed, as if one visitor downloaded all sixteen route nodes at once.
  Nobody does, so it says nothing about load time; it is deliberately blind to how the code is
  split, and exists only to stop the tree growing unwatched.
- **`alwaysLoadedJavaScriptBytes`** — what every visitor downloads on every page, and the one
  metric that rewards splitting. The always-loaded closure: the SvelteKit entry, the app
  shell, the root layout node and everything those import _statically_ (`bundle-closure.ts`,
  walking the client build's own manifest). Moving code behind a dynamic import takes it out
  of this number while usually adding a little to the tree total — exactly the trade the two
  JS budgets together are meant to reward.
- **`clientCssBytes`** — the stylesheet, which gets its own budget because CSS bytes never
  move the JS ones and would otherwise hide inside a total. There is exactly one file, and
  every page loads all of it.
- **`largestAssetBytes`** — a guard against one chunk growing unbounded while the totals still
  look fine. A single 200 KB file and four small ones cost a phone far more than five even
  ones of the same sum, and neither JS number can tell them apart.

Every budget sits a couple of percent above what the tree measures, on purpose. Previously,
SvelteKit's random `__sveltekit_<token>` identifier would vary by up to **four bytes**
between builds. Now `kit.version.name` is pinned during measurement builds
(`FIT_BUNDLE_MEASURE_VERSION` set), so the token is consistent and measurements are
byte-for-byte identical. `check:bundle` never rebuilds a stale output — the build always
sets `FIT_BUNDLE_MEASURE_VERSION`, which makes `vite.config.ts` embed a fixed-length
placeholder for `__APP_VERSION__` / `__APP_COMMIT__` instead of the real, git-derived one.

`check:bundle` always rebuilds before measuring — the `bun scripts/quality/bundle-budget.ts`
that `npm run check:bundle` runs is never a report of whatever happened to be sitting in
`.svelte-kit/output/client`, stale or otherwise. That rebuild also sets
`FIT_BUNDLE_MEASURE_VERSION`, which makes `vite.config.ts` pin `kit.version.name` and
embed a fixed-length placeholder for `__APP_VERSION__`/`__APP_COMMIT__`. The real version's
length is not stable — a tagged `main` stamps the short `v0.0.NN`, a branch ahead of its tag
stamps the eight-characters-longer `v0.0.NN+<sha>`, and a shallow or differently-fetched
checkout can see a different tag distance again. Additionally, `kit.version.name` pinning
ensures SvelteKit's `__sveltekit_<token>` is consistent. Both together make every measurement
build's byte count depend only on the code. `npm run build`, the deploy path, never sets that
variable and keeps embedding the real version and dynamic token.

`bun run bundle:headroom` also builds fresh and prints all four metrics against the budgets in
`quality/bundle-budgets.json`, never against a stale report; add `--against <ref>` (default
`origin/main`) to also print the delta and the top five changed chunks against another ref.
Unlike `check:bundle`, it embeds the real version (it exists to answer "what would this branch
actually ship"), so its number still carries that up-to-eight-byte version-stamp noise on top
of the four-byte SvelteKit one — expect its total to differ slightly from `check:bundle`'s for
the same tree. A proposal to raise a budget in `quality/bundle-budgets.json` must quote
`check:bundle`'s output as evidence.

## Mutation lanes

Pull requests run one lane, and it blocks: the complete Node-only server security closure.
The other three — changed Node files, changed client files, and the full-tree compatibility
audit — run once a day against `main` and report rather than gate. See "Where the mutation
lanes run" below. Test, spec and end-to-end artifacts are never mutation targets. Untracked production files count as
changes. Security-boundary specs belong exclusively to the always-on security lane; other
changed tests, deleted or renamed inputs, and mutation-configuration changes broaden the
affected lane rather than guessing narrowly.

Security and changed lanes use the **strict verdict**: only an explicit `Killed` result is
positive. Timeouts, uncovered mutants, errors, stale or source-mismatched reports, wrong
scope, omitted executable files, and an empty security scope all fail. A reviewed survivor is
classified as exact equivalence or host-specific defense in depth and bound to an exact
file/mutator/replacement/source-window fingerprint with a pull-request rationale. It is the
sole changed-line exception, is disclosed separately from the 100 percent observable
changed-mutant score, and is invalidated by source or report drift.

The `sourceHash` an entry pins is a hash of the mutated line plus one line of
context on each side, not the whole file (`sourceWindowHash` in
`scripts/quality/mutation-verdict.ts`). The fingerprint that identifies an
entry hashes that window together with the file, mutator and replacement --
deliberately not `location` — so a line inserted or removed above the mutant,
which shifts its line number without touching its text, changes neither the
window hash nor the fingerprint. An edit anywhere else in the file -- a
comment, an unrelated function, a rename three hundred lines away -- leaves
the window untouched and the acceptance stands; an edit that touches the
mutated line or its immediate neighbors changes the window hash, and the
entry silently stops matching and is reported as a stale survivor on the next
run. Two mutants whose windows hash identically -- the same few lines of
code appearing twice in one file -- collapse onto one fingerprint by design:
one review then excuses both, on the reasoning that identical code carries
identical reasoning. `mutation-review-check.ts` cannot lean on an entry's
own line number to find its window either, since that number goes stale the
same way; it searches the current file for a window matching the entry's
`sourceHash` instead (`sourceWindowStatus` in `mutation-verdict.ts`), and
reports the entry current if that search finds the window exactly once,
stale if it finds no match, and stale if it finds more than one — an
ambiguous match is not trusted to be the reviewed one. See issue #256 for
why the key moved off the whole file and off `location`.

When a configuration, test, deletion, rename, or non-mutated runtime input forces a broad
changed-lane fallback, actual changed production files retain the strict verdict. Unchanged
background files must preserve the historical 80 percent Stryker-compatible aggregate, so
existing legacy debt cannot masquerade as a new regression or make the gate knowingly red.
The verdict records this as `strict-changed-with-legacy-background` and reports both scores.
Scope records Git change status separately from added-line ranges: a production file modified
only by deletions is still strict even though it has no changed-line denominator.

Strict liability is lifted only from a change that is provably inert: it leaves lines in the
new source, Stryker anchored no mutant to any of them, and none of them reach code Stryker
could mutate. The last test is put to the syntax rather than to the mutant count, because
Stryker has no mutator for a renamed call target. The middle one asks where a mutant starts
rather than how far it reaches, because a `BlockStatement` mutant spans every comment in the
body it replaces. A rewritten comment, doc block or reordered import is excused; a deletion, a
rename, and any line Stryker anchored a mutant to are not, and the security lane never is. The
verdict reports the count as `inertFiles` and the lane prints it, so an excused file is
disclosed rather than quietly dropped.

Stryker's own aggregate break stands down on the two changed lanes, which the verdict governs
instead: it is harder than the break on every file it judges, and it holds unchanged fallback
files to the same 80 in their own pool. Leaving the break on would re-impose the whole-file
debt an excused file was just relieved of, from a pool that is often a single file. The break
remains the governing rule for the full-tree lane, and `mutation.break` is unchanged.

A lane that produces no report produced no verdict. It writes `crash.json` where `verdict.json`
would sit, prints the missing artifact, Stryker's exit code and the underlying error, and exits 97. Nothing about that run says a mutant survived, because no mutant was judged; the fixtures
`crashed-mutation-run` and `security-surviving-mutant` prove the same lane reports the two
endings differently. The crash the wording answers to is a worker race in the shared Vite
optimizer cache, which is unfixed and tracked separately.

`bun run test:mutation:full` preserves the pre-existing Stryker-compatible aggregate score and
80 percent threshold while legacy files are remediated. It runs forced-cold once a day on
`main`, and on demand through `workflow_dispatch`, `make audit`, or `bun run audit:mutation`.
Do not describe that legacy lane as killed-only, per-file, or zero-timeout.

Mutation caches are lane-specific and are recorded only after the governing verdict passes.
Never copy an incremental file between lanes or publish one from a failed or cancelled run.
The scheduled audit forces a cold run and shares its cache with nobody, so it can neither
duplicate nor race a pull-request lane.

### What the mutation lanes do not reach

Decided and recorded 2026-09-07 (#76). The lanes mutate production TypeScript under `src/`
that no `!` pattern in `quality/mutate-patterns.mjs` removes. That is wider than the
`src/lib/**/*.ts` include glob suggests: every lane hands Stryker an explicit file list built
by walking all of `src/`, so the include glob applies only to a bare `stryker run`, and just
the `!` patterns survive into a lane. All nine `+server.ts` route handlers are mutated that
way, most of them by the blocking security lane. What is genuinely outside every lane is
`.svelte`, `scripts/`, `tests/`, and the ten files a `!` pattern names.

| Outside the lanes                        | Files | What covers it instead                                                                                                                                                                                                      |
| ---------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Svelte components under `src/lib/`       | 76    | 88 component specs in the vitest browser project, and the per-file 80 percent coverage floor — `test:coverage:client` includes `src/lib/**/*.{ts,svelte}`.                                                                  |
| Svelte components under `src/routes/`    | 15    | 16 Playwright `*.e2e.ts` specs across the browser matrix, and 6 page specs. No coverage floor reaches them: both coverage includes name `src/lib` only.                                                                     |
| `scripts/**`                             | 88    | 47 unit specs, run by the vitest `server` project. `scripts/security/` (7 modules) and `scripts/eval/` (1) have none. No coverage floor and no mutation, so a deploy script's only test is the one somebody chose to write. |
| `tests/**`, the end-to-end harness       | 5     | `tests/e2e-workspace.spec.ts` covers the workspace builder; the other four are exercised only by running the end-to-end suite.                                                                                              |
| `.ts` under `src/` a `!` pattern removes | 10    | Each exclusion carries its own reason at the pattern in `quality/mutate-patterns.mjs`.                                                                                                                                      |

Widening the glob is a gate policy decision and is not taken here. What is settled is that
the boundary stops being invisible. `check:mutation-scope`
(`scripts/quality/mutation-scope-ledger.ts`) enumerates the source files outside the lanes by
asking the same two modules the lanes ask — `mutation-scope.ts` and `mutation-globs.ts` — so
it cannot drift from what Stryker is actually handed, and compares the result against
`quality/mutation-uncovered.json`. A new component, a new deploy script, or a newly excluded
module fails the static tier until its path is recorded there deliberately;
`bun scripts/quality/mutation-scope-ledger.ts --write` regenerates the file and the diff is
what gets reviewed. A recorded path that leaves the tree, or that a lane starts reaching,
fails the same way, so the record cannot quietly go stale. The fixture
`unrecorded-blind-spot` proves it rejects an unrecorded component.

### Where the mutation lanes run

Decided 2026-09-04 by Gabriel, the product owner, to cut runner minutes — not wall clock,
and not strictness.

| Lane                           | Cold  | Where it runs                | Blocks?     |
| ------------------------------ | ----- | ---------------------------- | ----------- |
| `test:mutation:security`       | 3m50  | every pull request           | yes         |
| `test:mutation:changed:node`   | 2m34  | daily on `main`              | no, reports |
| `test:mutation:changed:client` | 8m51  | daily on `main`              | no, reports |
| `test:mutation:full`           | 18m07 | daily on `main`, forced cold | no, reports |

Those are cold numbers. The sub-minute times some pull requests show are incremental cache
hits, not the cost of the lane, and budgeting from them understates what a push actually
buys. Removing the three moved lanes saves about 29.5 runner-minutes per pull-request run;
they were never the critical path either — so the wall clock a contributor waits is
roughly unchanged.

**End-to-end parallelism is capped at half the cores on purpose.** Each worker owns a
preview server and a database, so nothing stops it going higher -- but WebKit on Linux is
this suite's fragile engine, and `failOnFlakyTests` turns a test that only passes on the
retry into a red build. Main flaked a `mobile-safari` test at `workers: 1` in run
33917056886, before any sharding existed, so the fragility is the engine and not the
parallelism; three workers on a four-core runner made it likelier, timing out a drawer
click in run 33920548201. Half the cores measured clean. Raise it only with a measurement.

**The critical path is the security mutation lane, twice over.** Measured 2026-09-04, after
sharding (run 33918527511): `Gate self-test (mutation)` 267s and `Mutation (security)` 249s,
with the four end-to-end shards finishing in 91-188s and their merge job in 21s. Both of the
first two are the same work — one is the lane itself, the other is the
`security-surviving-mutant` fixture at 233s proving that the lane goes red when a mutant
survives. That fixture runs the lane cold, with no incremental cache, which is what makes it
proof; warming it from the hosted cache would cut it to under a minute and would prove only
that the warm path reports debt. Do not do that. Everything else in the workflow finishes
inside two and a half minutes.

Before the sharding the same workflow took about ten minutes: `Gate self-test` at 547s ran
all 31 fixtures in series, because its pool was `min(4, cores / 4)` and a hosted runner has
four cores; `End-to-end` at 611s ran four browser projects on one runner at `workers: 1`.
Neither number was a limit of the work — both were a limit of how it was arranged.

**Why the security lane is the exception.** It stays blocking because the authentication
boundary is the one place where a test that fails to assert is a security risk rather than a
maintenance cost: a surviving mutant in `src/lib/server/users/` means a session, password or
household check that nothing would notice breaking. Everywhere else, mutation debt is work
owed, and work owed can be paid daily. It is also the cheapest of the four cold, so the
exception costs 3m50 rather than the 29.5 minutes the rest would.

**Why the other three do not block.** "Let's not fail the CI because of mutation — we will
pay debt daily." A red daily lane that nobody is waiting on stops being a gate and becomes a
report, so it is written as one: each lane runs under `continue-on-error`, and
`scripts/quality/mutation-debt.ts` reads every `verdict.json` and `crash.json` afterwards and
turns them into one Markdown report naming the mutants that were not killed. That report
becomes warning annotations, the job summary, and, per file below on the debt rule and the
ledger issue it feeds, a `mutation-debt`-labelled issue that is edited in place rather than
reopened daily. A lane that crashed rather than reaching a verdict raises a separate,
`quality`-labelled issue in the older comment-per-run style, because a crash measured
nothing and is not the same thing as a surviving mutant. A lane that swallowed its exit code
and printed nothing would be worth less than not running it at all.

**"Changed" on a schedule.** The changed lanes are defined against a diff, and a scheduled
run on `main` has no base ref. Left alone, `resolveMutationBase` falls through to
`origin/main`, whose merge-base with `HEAD` is `HEAD` — an empty scope, a lane that mutates
nothing, and a green result that proves nothing. So the workflow resolves the base itself:
the tip of `main` as it stood 24 hours earlier, which makes the lanes judge exactly what
merged since the last audit, a day late but with the strict killed-only verdict intact. If
nothing merged, the base resolves to `HEAD`, and the changed lanes are skipped with that
said out loud in the job summary rather than reported clean over an empty scope. If no base
resolves at all the audit fails there, because that is a broken audit rather than a quiet
day. The full lane runs regardless.

**Thresholds did not move.** `quality/mutation-policy.json` and `quality/thresholds.json` are
untouched, the 80 percent Stryker-compatible aggregate and its `mutation.break` still govern
the full tree, and the daily run forces a cold measurement — stricter than the incremental
run a pull request used to get. Not blocking is not the same as not measuring: lowering a
number would make the daily report understate the debt it exists to find, which is the one
thing that would make the whole arrangement pointless.

What this trades away is honest: mutation debt outside the security lane is now noticed
within a day, in an issue, rather than at the moment it is introduced.

### Why `Gate self-test (mutation)` also left the pull-request path

Decided 2026-09-05 by Gabriel, the product owner. `Gate self-test (mutation)` was the
longest job on every pull request (~300s, see the sharding numbers above) and it does not
mutate the app: it runs Stryker against fixture projects under `scripts/quality/` to prove
the mutation gate itself still kills a planted mutant. Only a change to the gate scripts,
`quality/`, the Stryker configs, the workflows that wire the self-test up, or the toolchain
pins it runs under can break it, so a pull request that touches none of those cannot break
it either.

`scripts/quality/self-test-scope.ts` diffs the pull request (or push) against its base and
checks the changed paths against exactly those globs: `scripts/quality/**`, `quality/**`,
`stryker*.config.*` at the repo root, `.github/workflows/**`, `package.json`, `bun.lock`,
and `.tool-versions`. A new `self-test-scope` job in `ci.yml` runs that check first; the
`self-test` job's `mutation` matrix leg then carries `if: matrix.group != 'mutation' ||
needs.self-test-scope.outputs.mutation-needed == 'true'`, so it reports a skipped (neutral)
check rather than running unconditionally, while `browser` and `static` still run on every
pull request. `check:ci-contract` still asserts that the matrix declares all three groups;
that assertion is about the matrix's shape, not the condition, so nothing there needed to
change.

Skipping it on the pull requests that cannot reach it moves the longest job on a typical
pull request from `Gate self-test (mutation)` (~300s) to the `mobile-safari` end-to-end
shard (~200-235s). Nothing is removed: the group still runs every day regardless of what
changed, as `scheduled-self-test-mutation` in `mutation-audit.yml`, which is why this PR
(it touches `.github/workflows/**`) is itself proof the trigger fires when it should.

### Paying down mutation debt

Decided 2026-09-05 (issue #87, option 1, Gabriel's call): **every survivor is debt,
regardless of aggregate score.** The full lane's own aggregate score can clear 80% while
carrying well over a hundred surviving, uncovered or timed-out mutants underneath it — that
was the gap #87 found, and the old debt rule only looked at whether a lane's own verdict had
failed, so it never noticed. `scripts/quality/mutation-debt.ts` now flags debt the moment
`Survived + NoCoverage + Timeout` is non-zero for any scheduled lane, whether or not that
lane's own threshold still passes, and its report ranks files by survivor count within each
lane, worst first, with full mutant descriptions for the worst three.

That report lives in one GitHub issue, marked `<!-- mutation-debt-ledger -->`, titled
"Mutation debt ledger", labelled `quality` and `mutation-debt`. Each scheduled run replaces
its body with the fresh report rather than commenting, so a week of debt reads as one
current state, not seven stale updates; the issue closes itself once a run reports zero
survivors and reopens the moment one appears again. A lane that crashes instead of reaching
a verdict is a different failure — nothing was measured, which is not the same as a
surviving mutant — and still raises the older comment-per-run `quality`-labelled issue,
because a crash is worth a longer trail, not a body that gets overwritten.

`bun run debt:pay` (`scripts/quality/debt-pay.ts`) turns the latest evidence into a plan an
agent can start from: it reads whichever of `reports/mutation/{full,changed-node,changed-client}/mutation.json`
exist (preferring the full lane, since it already covers everything the changed lanes would
otherwise double-count), ranks files the same way the ledger does, and writes the three
worst with every surviving mutant's mutator, line and a one-line original-to-mutated
snippet to `reports/mutation/debt-plan.md`. Pass `--from-ci` to pull the most recent
successful scheduled run's artifacts first, for a machine that has not just run
`test:mutation:full` itself.

**The daily routine.** An agent runs `debt:pay`, takes the three worst files it names, and
kills their surviving mutants with tests that assert behavior a person cares about — never a
suppression, never a threshold change. It runs the mutation lane that owns whichever files it
touched, opens one pull request whose body carries a per-file before/after table, and a
reviewer checks the new tests are not written backwards from the mutant description to kill
it while testing nothing real. An equivalent-mutant call goes in that pull request's body for
Gabriel to decide; the agent never edits `quality/mutation-equivalents.json` itself. The
`mutation-audit.yml` workflow also accepts a manual `refresh_ledger_only` dispatch input, to
pull the ledger issue back up to date from the last successful run's artifacts without
paying for a fresh measurement.
