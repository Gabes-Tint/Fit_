# Delegation and implementation gates

Status: implemented for blocks 1-5's boundaries - selection, assignment,
pre-launch barrier, bounded repair loops, one-rung escalation, the final
join and the ordinary stop/preserve rules, the delivery gates (push, PR,
review, merge) and the ship gates (tag, main CI, deploy, smoke, the flaky
decision, android, cleanup) and the resume and reset rules (below) - as of
the driver behind `go.py`. Coordinated cancellation remains future: an
external process interruption leaves a deliberately uncertain retained
record, which `go.py <n> --resume` reconciles afterwards rather than
replaying. This page distinguishes implemented behavior from those target
invariants; behavioral changes belong in the driver and its tests.

## Inputs and ownership

The driver retains block 1's ordered list of one or two slices (`domain`, then
`ui` when both exist, or a single `workflow` slice). Each slice already has an
issue number, brief, acceptance criteria, test kind, failing test paths,
branch, worktree and team. Block 2 must reuse those identities. It does not split again, create replacement issues
or worktrees, or ask a worker to rediscover the brief.

That order is also the dependency order. A UI slice usually renders what its
domain sibling supplies, so its acceptance tests cannot pass before the domain
implementation exists; the planner says so with `needs_sibling` on the `ui`
slice, and the driver accepts it and runs that slice after the domain one. The
dependency never runs the other way: a `domain` slice must not depend on the UI
slice, both slices must not depend on each other, and the only slice of a
one-slice story has no sibling to depend on. Each of those is a rejected plan.

Before delegation the driver must retain an immutable record of these inputs,
the validated failing-test commit, the repository base commit, and the exact
agent configuration loaded at startup. These are proposed retained records,
not fields currently persisted by block 1. Evidence points to that record or
to repository content at the recorded commit; mutable issue text is not enough.

The driver owns classification, validation and transitions. An agent may
extract signals or propose evidence, but a role name or a claim that tests
passed is never the verdict. Work is confined to the assigned worktree, with
no writes to its sibling or the shared checkout. The driver's own source,
prompts, agent configuration and gate policy cannot be changed _for_ this run:
a `workflow` slice edits its worktree's copy like any other file, the running
driver is the shared checkout's code, and nothing it produces takes effect
until Gabriel merges it.

Before the failing-test commit is accepted, the driver validates it as what
it will become: an immutable input. It runs the repository's change-scoped
lint over the branch (`bun run lint:changed`), the repository's type lane
(`bun run check`) and the repository gate's own content steps -
`duplicates`, `format:check` and `check:suppressions`, selected through the
gate's own `--only` because the full tier would run the tests that must
still fail here. Those three judge bytes rather than behavior, so their
verdict on this branch is exactly the verdict block 3 will get on the same
bytes; any failure returns a precise, repairable diagnostic (outcome
`TESTS_INVALID`, exit 31) to the same mechanic retry loop and never reaches
implementation.

Failing is also not enough on its own: the driver reads each failed test's
error message out of the runner's JSON report and requires it to be a failed
expectation. A test that throws - a helper called with an argument of the
wrong type (#399), a name that does not exist, a syntax error - can never
pass however the behavior is implemented, so it is rejected as
`TESTS_INVALID` with the file, the test title and the runner's own message
in the diagnostic. A module or export that cannot be resolved is not a
throw of that kind: the dynamic import of a module that does not exist yet
is the sanctioned pattern below, and its rejection is exactly the missing
behavior. It also rejects
lint suppression directives (`eslint-disable`, `eslint-enable`,
`@ts-ignore`, `@ts-expect-error`) inside acceptance tests outright: a
directive that is only satisfied before the implementation exists, such as
suppressing `no-unsafe-assignment` on a dynamic import of a module that does
not exist yet (#377), turns into an unfixable lint break the moment the
implementation lands, and an implementation worker cannot legally fix it.
Consequently the mechanic must write assertions that lint clean both before
and after the behavior exists (for a missing module: dynamic import through
the promise chain with `unknown`-typed binding, not suppression).

## Where an acceptance test lives

Placement is checked in block 1, before the bytes become immutable. A
playwright acceptance test (`*.e2e.ts`) must live under `src/routes/`, where
every one in the repository already does; a vitest spec sits beside the
module it covers, under `src/`. A file in the wrong folder is a repairable
diagnostic naming the file and the folder it belongs in, exactly like the
wrong-test-kind check beside it.

The rule comes from the coverage lane, not from playwright:
`playwright.config.ts` sets no `testDir`, so it would run an `*.e2e.ts`
anywhere, while `test:coverage:client` includes `src/lib/**/*.{ts,svelte}`
as source and excludes only `*.spec.ts`/`*.test.ts`. An `*.e2e.ts` under
`src/lib/` is therefore a source file no unit test ever loads: 0% lines
against a per-file threshold of 80%. Block 3's `verify:changed` does not run
coverage, so nothing saw it until CI, on a pull request where nobody could
change the file any more (#397).

The rule reads the repository's TypeScript layout, so it is a product
rule: a `workflow` slice's Python tests are placed by their own rule, below.

## The workflow layer

A story about this flow's own driver is a slice like any other, at the third
layer: `workflow`. Its code, its tests and the prose describing it all live in
two directories, so its boundary is an allowlist rather than a partition - a
`workflow` slice may change `workflow/**`, `docs/**` and the repository's
`cspell.json`, and a path outside those (`src/`, `scripts/`, `quality/`,
`.github/`) is a boundary rejection naming the file. The product layers are
untouched by this: `domain` and `ui` reject each other's areas exactly as
before.

It is always the only slice of its story. `spans_domain_and_ui` is false, it
never appears beside `domain` or `ui`, and `needs_sibling` therefore never
applies - a one-slice story has no sibling to wait for, which the driver
already rejects. The rung is chosen from the same nine signals, by the same
precedence table.

Its test kind is `pytest`. The acceptance tests are `workflow/tests/test_*.py`
and run under `uv run --project workflow pytest -q <files>` from the
repository root. Block 1 proves they fail and block 3 proves they pass, from
pytest's own short summary (`-rA`): a `FAILED` line carries the assertion that
is waiting for the behavior, and an `ERROR` line is a module pytest could not
collect - a broken test, not one failing because the behavior is missing, and
it goes back to the mechanic as such, exactly as a thrown `TypeError` does in
a vitest slice.

The whole of `workflow/tests/` is test-side, so block 1 may also change
`workflow/tests/conftest.py` and a fake under `workflow/tests/fakes/`: a new
flow scenario needs its `given_*` helper and usually a scripted answer from a
fake, and neither is driver code. Only a `workflow/tests/test_*.py` file may
be reported as an acceptance test - pytest collects nothing from a
`conftest.py` or a fake, so naming one is a `TESTS_NOT_PUSHED` correction.

Its gates are the driver's own, in both block 1 and every block 3 turn, in
place of `verify:changed` / `lint:changed` / `check` / `gate.ts verify:fast`,
which size and run the repository's TypeScript and have nothing to say about
Python:

- `uv run --project workflow ruff check workflow`
- `uv run --project workflow ruff format --check workflow`
- `bun x prettier --check <changed markdown>`
- `bun x cspell --no-progress <changed markdown>`

The markdown pair runs only over the changed `.md` files under `workflow/` and
`docs/`, so a turn that changed no prose does not run it. Each of the four
names the files and lines it rejects, so the failure comes back located and
block 3's `TESTS_INVALID` rule works unchanged: a gate failure confined to the
retained acceptance tests stops the run instead of spending an implementer's
corrections on bytes it may not change.

Block 4 is unchanged and is the point of the layer's existence: the pull
request is opened, CI runs, and then the merge is withheld. The driver never
merges its own code, so the run ends `NEEDS_GABRIEL` (exit 11) with the PR
open and every worktree in place.

## The component harness

A UI slice's acceptance tests are only `*.e2e.ts`, so a component no page
renders yet would be unreachable. The repository owns one reusable harness
route, `src/routes/dev/component-harness/+page.svelte`: it mounts any single
component from `src/lib/components` or `src/lib/ui` at
`/dev/component-harness?component=<path>&props=<json>`, and an unknown id
renders the distinctive `harness: component not found` line. It covers only
its two `import.meta.glob` directories - routes, the store, server code and
the harness's own files cannot be exercised through it. A playwright
acceptance test must go through the harness route for component assertions;
importing product code inside `page.evaluate` is rejected (outcome
`TESTS_INVALID`) the same way a new route fixture is: those are production
files, and creating or modifying routes or production components stays
prohibited.

The harness itself is a test-only surface: the web server answers 404 for
`/dev/` unless the run names `FIT_COMPONENT_HARNESS=yes` (`hooks.server.ts`),
and the Capacitor static build refuses it outright (`+page.ts`), so the URL
never mounts a component inside the shipped app - only the E2E preview
servers open it, and those serve the same production build the tests are
meant to validate.

## Selection gate

These are the required signals for each slice. Every boolean needs explicit
evidence for its value; omission is not `false`. An unresolved factual signal
is rejected as incomplete input, rather than silently choosing a model.

| Signal               | Type                                                                       | Meaning                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `objective_clear`    | boolean                                                                    | Observable acceptance criteria and scope determine the intended behavior.                                                                                                                                                                  |
| `area_known`         | boolean                                                                    | Concrete repository files or directories bound the implementation.                                                                                                                                                                         |
| `pattern_known`      | boolean                                                                    | A cited existing implementation provides an applicable pattern.                                                                                                                                                                            |
| `procedure_complete` | boolean                                                                    | Ordered instructions determine the edits without a relevant implementation choice.                                                                                                                                                         |
| `solution_uncertain` | boolean                                                                    | Choosing the solution requires investigation beyond applying a known pattern. Contradicts `technical_choice="bounded"`: a bounded choice is ordinary construction within a known pattern, so this is false whenever the choice is limited. |
| `cause_uncertain`    | boolean                                                                    | A defect's cause remains unresolved.                                                                                                                                                                                                       |
| `technical_choice`   | `none`, `bounded`, `open`                                                  | No relevant choice, ordinary construction within a known pattern, or unresolved architectural/behavioral choice.                                                                                                                           |
| `sensitive_areas`    | unique array of `auth`, `shared_state`, `store`, `security`, `persistence` | The requested change affects authorization, shared state, the store, a security boundary, or stored-data integrity/migration. Empty means all were checked and excluded.                                                                   |
| `human_decision`     | boolean                                                                    | Product, spend, infrastructure, secrets, gate lowering or data deletion still requires a decision under block 1's ownership policy.                                                                                                        |

The driver checks the following rows in order; the first applicable row wins.
Neither diff size nor file count participates.

| Priority | Condition                                                                            | Decision                                                           |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1        | Missing, stale or contradictory evidence; invalid types; changed input identity      | Reject the contract; launch no worker.                             |
| 2        | `human_decision=true`, or `objective_clear=false`                                    | Stop for clarification; no role can decide missing product intent. |
| 3        | Any sensitive area, uncertainty, `technical_choice=open`, or an unknown area/pattern | `solver`                                                           |
| 4        | Complete procedure and `technical_choice=none`                                       | `mechanic`                                                         |
| 5        | Otherwise                                                                            | `builder`                                                          |

Row 4 is reached only with a clear objective, known area, no uncertainty and
no sensitive area. `pattern_known` is not a separate row-4 requirement: a
truly complete procedure determines the edits itself, so a claimed missing
pattern cannot force a full solution investigation while the same signals
also claim `procedure_complete`; the capability model treats a complete
procedure as its own pattern. When the procedure is not complete, an unknown
pattern still selects solver at row 3. A complete procedure claiming a bounded or
open choice contradicts its definition and fails row 1. A known area may still
have an uncertain cause; that is valid and selects solver. Sensitivity always
outranks an otherwise mechanical procedure. Builder handles ordinary
construction, including a bounded choice, but never fills a product gap.

Evidence must identify the relevant acceptance criterion, repository path and
source passage, as applicable. Evidence claiming no sensitive work must cover
the complete declared area, including server routes; frontend wording alone
cannot establish absence of server authorization changes. Unsupported or
conflicting claims stop at the contract gate. They do not consume an
implementation attempt or trigger capability escalation.

## Assignment envelope

This JSON is a documentary proposal for the driver-produced handoff. All
listed fields are required; unknown fields and `null` are rejected at every
object level. Strings are nonempty. Integers exclude booleans. A record is
immutable once accepted; escalation creates a new assignment revision.

| Field       | Type and invariant                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`   | integer, exactly `1`                                                                                                                                                                                      |
| `slice_ref` | string identifying the retained block 1 slice record within this run                                                                                                                                      |
| `revision`  | integer `0..2`; starts at zero and increases exactly once per escalation                                                                                                                                  |
| `role`      | `mechanic`, `builder` or `solver`; must equal the decision above, or the previous role's immediate successor on escalation                                                                                |
| `config`    | object with exactly `backend`, `model`, `effort`, all strings; exact match to the selected role in the startup configuration                                                                              |
| `signals`   | object containing exactly the nine signals in the selection table                                                                                                                                         |
| `evidence`  | nonempty array of objects with exactly `signal`, `source_ref`, `detail`; all strings; `signal` names one selection signal, `source_ref` resolves to immutable retained input, `detail` explains the value |
| `reason`    | nonempty string explaining the winning decision row, or exhaustion and the prior assignment on escalation                                                                                                 |

Every signal must have at least one evidence entry. References must resolve
inside the same run. `slice_ref` supplies the existing issue, worktree, team,
branch, brief, acceptance and test information; those fields are intentionally
not copied into the envelope. The resolved prompt includes them verbatim, and
the launch gate verifies them against the retained record. `config` is copied
deliberately to make the actual model selection auditable; it grants no
authority to override the startup configuration. Revisions do not reclassify
the original signals. New scope or new human decisions stop the run.

For example, assuming the referenced input and illustrative mechanic
configuration exist, this is a valid assignment:

```json
{
	"version": 1,
	"slice_ref": "run-140/domain",
	"revision": 0,
	"role": "mechanic",
	"config": { "backend": "claude", "model": "haiku", "effort": "low" },
	"signals": {
		"objective_clear": true,
		"area_known": true,
		"pattern_known": true,
		"procedure_complete": true,
		"solution_uncertain": false,
		"cause_uncertain": false,
		"technical_choice": "none",
		"sensitive_areas": [],
		"human_decision": false
	},
	"evidence": [
		{
			"signal": "objective_clear",
			"source_ref": "run-140/domain/acceptance/0",
			"detail": "Replace the specified display label."
		},
		{
			"signal": "area_known",
			"source_ref": "run-140/domain/brief",
			"detail": "The brief names the display-label module."
		},
		{
			"signal": "pattern_known",
			"source_ref": "run-140/domain/pattern",
			"detail": "The adjacent label has the required form."
		},
		{
			"signal": "procedure_complete",
			"source_ref": "run-140/domain/brief",
			"detail": "Exact old and new values are specified."
		},
		{
			"signal": "solution_uncertain",
			"source_ref": "run-140/domain/brief",
			"detail": "The replacement fully determines the solution."
		},
		{
			"signal": "cause_uncertain",
			"source_ref": "run-140/domain/acceptance/0",
			"detail": "This is a specified label change, not an unexplained defect."
		},
		{
			"signal": "technical_choice",
			"source_ref": "run-140/domain/brief",
			"detail": "No implementation choice remains."
		},
		{
			"signal": "sensitive_areas",
			"source_ref": "run-140/domain/pattern",
			"detail": "The complete scope is display text, with no sensitive behavior."
		},
		{
			"signal": "human_decision",
			"source_ref": "run-140/ownership",
			"detail": "The wording is already approved."
		}
	],
	"reason": "Selection row 4: fully specified procedure."
}
```

Invalid variants of that example include `"role": "builder"` with unchanged
signals (wrong row), omitted `cause_uncertain` (missing signal),
`"technical_choice": "open"` with a complete procedure (contradiction), and
`"worktree": "/tmp/other"` (unknown field and attempted identity override).
A solver assignment with `"sensitive_areas": ["auth"]` can be valid with
supporting evidence and matching solver configuration, even for a one-line fix.
It is invalid if the startup configuration has no solver entry.

## Launch and turn barriers

The pre-launch barrier validates all assignments before any implementation
worker starts. All block 1 slices must have succeeded. Verify each exact
branch and clean worktree at the recorded failing-test commit, pushed state,
retained test list and failing-test validation evidence, team ownership, brief,
configuration, and real paths inside that slice's worktree. Reject duplicate
teams, paths or branch identities. Reserve exclusive ownership of the story
and its slice resources before launch; a second execution must fail without
starting workers. A held issue label alone is not an exclusive lock.

Two slices are independently testable against their recorded inputs, or the
UI slice declares that it is not. A declared dependency (`needs_sibling` on the
`ui` slice, persisted as `depends_on`) is accepted and ordered, never waited on
inside a turn: the pre-launch barrier still verifies both slices' resources
before anything launches, the domain loop runs first, and the UI loop launches
only after the domain slice is frozen. Nothing else may substitute for that
ordering - a worker must not wait for its sibling, invent a mock that replaces
the acceptance boundary, or copy sibling changes. A dependency in the other
direction, a circular pair, or one declared by the only slice of a one-slice
story is rejected as `PLAN_REJECTED` with `blocked`, and needs a revised plan in
a new run.

Between the two loops the driver, not a worker, brings the sibling in: it
merges the frozen domain commit into the UI branch as an explicit merge commit
and pushes the branch. That merge becomes the slice's `failing_sha` - the base
every later check compares HEAD, `origin` and the diff against - while
`tests_sha` keeps naming block 1's failing-test commit, which is the immutable
acceptance evidence. A merge conflict means the two slices were never the
layered pair the plan claimed: `PLAN_REJECTED` with `blocked`. The UI
acceptance tests are then re-run on the merged tree and must still fail; tests
the domain slice alone satisfies leave nothing for the UI slice to implement
and stop the run as `TESTS_DO_NOT_FAIL`.

Before every turn, verify exclusive ownership, unchanged driver/configuration,
current assignment, expected branch and worktree, absence of another active
worker, and the previous turn's settled result. Corrections may start with the
previous turn's dirty implementation; the initial launch must start clean.
Only one turn or validation runs per slice at a time.

After every turn, the driver independently checks the returned structure,
actual diff scope and branch identity, acceptance behavior, and the applicable
foreground pre-push checks in `QUALITY.md`. Acceptance tests retained from
block 1 must execute and pass; removing, skipping, weakening or replacing their
assertions is a contract failure. New regression tests may be added, and any
other test inside the slice's own layer may change.

A still-failing acceptance test is a repairable diagnostic that names every
failed test's title and error message, so the worker learns what to fix
rather than only that something failed. When such a failure is a throw
raised inside the acceptance test itself or a test helper, the test is
defective and no implementation can satisfy it: the run stops with
`TESTS_INVALID` attributed to block 1, labelled `blocked`, without
consuming a correction or spending the escalation ladder, and the story
needs a fresh run once the test is repaired. A throw raised inside product
code is an ordinary implementation bug and stays with the correction loop. Gate
reports must belong to this turn's actual content and requested commands,
contain every required result and valid artifacts, and have passing exits.
Missing reports, runner crashes or stale reports cannot be treated as failed
assertions or as success. No full local CI tier is implied.

The driver determines affected specs, e2e files and mutation lanes from the
actual diff under the recorded policy, not just the agent's reported files.
`changed_files` must name every path that diff touches - added, modified,
deleted and renamed, both names of a rename. Because nothing the driver
trusts is derived from it, a list that disagrees with the diff is a
repairable diagnostic naming the unreported and phantom paths, corrected in
the same session like any other, not a contract failure; a turn that changed
nothing at all is the same repairable diagnostic. Any real-diff verdict -
scope, layer boundary, acceptance bytes, gates - takes precedence over it.
That diff is the complete delta of the branch and worktree against the
retained failing-test commit, recomputed at every validation: an
out-of-reach gate, threshold, suppression-baseline, lockfile or CI-workflow
change (#379) cannot be hidden by the timing of a retry commit or an
uncommitted edit. What is out of reach is what judges the work: everything
under `quality/`, `.github/`, `scripts/ci/`, `scripts/deploy/`,
`scripts/github/`, `scripts/quality/` and `scripts/security/`, every
snapshot and lock file, the tool configuration files and
`workflow/agents.yaml`. Only those script folders: `scripts/` also holds
the application's own tooling - the ETL pipeline, the search evaluation
harness, the dev and build helpers - which a story may perfectly well be
about, and forbidding the whole tree cost #337 a run over
`scripts/eval/`. The brief the implementer receives renders that list from
the same constant the validation reads, so the rule the agent is told and
the rule it is judged by cannot drift. The driver's own code under
`workflow/` is not out of reach either - the agent edits a worktree copy
while the running driver is the main checkout's code, and the driver's
suite is CI's own "Workflow driver" job, not a block 3 gate - so a slice
may implement a change to the driver. Merging it is what the driver will
not do: see the delivery gates.

Reaching outside that scope - an out-of-reach path, a file belonging to the
other layer, or a snapshot or lock file - is a repairable diagnostic, not
an immediate stop. The driver keeps the worktree and session, names every
offending path, and asks the same agent to put them back exactly as they
were and to say so in its summary if the story genuinely needed one of
them; the next validation judges the whole diff again. It costs an ordinary
correction and is never escalated to a stronger role - no model is the
answer to "you changed a file you may not change" - and when the budget
ends with the change still present the run stops as `AGENT_BROKE_CONTRACT`
(exit 22). A corrective turn that leaves the same path there ends the
budget on the spot: the rejection came back verbatim, so the attempt after
it would only reproduce it. Acceptance-test bytes are the exception: they are judged before
scope and terminally, because their immutability is the contract itself. Any local commit happens under driver control before final validation; a
successful slice has a clean, recorded implementation commit and evidence for
those exact bytes. Implementation agents do not push or open PRs. Block 1's
already-pushed failing-test branch is an existing input, not delivery approval.

## Per-slice transitions

Each role receives one initial turn and at most two correction turns. Keep
`attempt` as an integer `0..3` for the current role: zero before launch,
incremented and persisted before each launch. Validation does not increment
it. `escalations` begins at zero and increases only on a role change, to at
most two. It equals assignment `revision`. Attempts reset to zero only on
escalation. Thus a mechanic start allows at most nine implementation turns,
a builder start six, and a solver start three, excluding block 1 turns.

Three is a ceiling, not a quota. A correction is worth taking only when the
agent can act on what it was told, and a diagnostic that comes back
identical after one says the opposite: the agent already tried, the verdict
did not move, and the attempts left would only reproduce it. So when the
rejection of attempt N+1 is the rejection of attempt N, the role's budget
ends there, exactly as exhaustion would end it - escalating one rung, or
stopping the run on a solver or a contract breach - and the narration, the
turn ledger (`"repeated": true`) and the comment on the story all say how
many attempts went unspent. "Identical" is judged on substance: the
diagnostics are compared with their commit shas, durations, timestamps and
absolute worktree paths normalized away, so a rejection naming a different
file, test or count is a different rejection and its correction is worth
the attempt. The stronger role always gets its own full budget: an
escalated role's first attempt has no predecessor to repeat.

| From             | Condition/action                                                                               | To           |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| `assigned`       | Launch gate passes; reserve attempt 1                                                          | `running`    |
| `running`        | Worker ends normally with a valid reply                                                        | `validating` |
| `validating`     | All independent checks pass at the recorded commit                                             | `succeeded`  |
| `validating`     | Repairable failure differing from the previous attempt's, and attempt less than 3              | `correcting` |
| `correcting`     | Same role, identity, session and worktree; reserve next attempt                                | `running`    |
| `validating`     | Repairable failure at attempt 3, or one identical to the previous attempt's, role below solver | `escalating` |
| `escalating`     | Immediate next role, matching frozen configuration, new revision and attempt zero              | `assigned`   |
| `validating`     | Repairable failure at attempt 3, or one identical to the previous attempt's, on solver         | `failed`     |
| Any active state | External failure, contract violation or required human decision                                | `failed`     |

Escalation preserves issue, team, branch, worktree, brief and accumulated
implementation. The old role's worker must have ended. The next role uses its
own identity/session within that team, receiving the original brief and all
prior diagnostics. Never silently reuse a lower role's backend session with
different model settings. If the harness cannot guarantee session identity,
stop as a tool failure. Corrections within a role always reuse its session.

All unlisted transitions are prohibited. In particular: no downgrade, skipped
rung, early escalation based on an agent's self-assessment, fourth turn at one
role, or automatic transition out of `succeeded` or `failed`. A spent budget is
the only capacity escalation trigger - spent to attempt 3, or ended early by a
rejection that repeated verbatim. A request for a stronger model still needs
the normal independent diagnostic and correction budget.

Persist a turn identity before launching and its completion before choosing
the next transition - with the reply the turn ended with and a digest of
the working tree at that moment. Duplicate completion for the same identity
is a no-op; conflicting completion is a contract failure. An interrupted
process resumes only after proving exclusive ownership (the story lock) and
reconciling each slice with the worktree it left; see
[Resume and reset](#resume-and-reset). A completed turn with a reply resumes
validation without another agent call, on the same bytes; a turn still
running on the machine is never relaunched beside; a turn that died or never
produced a reply is voided and relaunched under the same attempt number. An
assignment or correction with no reserved turn proceeds normally. Changed
bytes, an interrupted review fix or an unreadable record stop and preserve
the worktree. Nothing resets counters.

## Failure decisions and issue record

Classify from driver evidence in the precedence below. If a tool failure
prevents establishing a code defect, report the tool failure. Workers cannot
choose their own retry category.

This classification's own no-retry rule sits above one narrower exception:
`github.py` and `agents.py` each retry once, transparently, before a `gh`
call or an `aarmy talk` ever reaches this table - a GitHub 5xx ("Something
went wrong while executing your query"), an HTTP 5xx, a network timeout,
a DNS failure, a rate limit, or (for `aarmy talk` only) a backend that
returned no message at all. That retry is a transport-level correction for
a passing blip, not a retry/escalation of the turn itself; if the retry
also fails, the failure reaches this table exactly as before and is
classified and stopped the same way.

| Precedence and type     | Examples                                                                                                                                                                                     | Action                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: `contract`           | Malformed assignment/reply, agent commit or push, weakened acceptance test, identity mismatch, an out-of-reach or other-layer path still there at the end of the budget                      | Stop immediately; preserve; no retry/escalation. An out-of-reach path is corrected first (row 4) and reaches this row only when the budget ends with it still there. |
| 2: `external`           | Authentication, network, launch, unavailable tool, timeout, crash, missing/invalid runner report                                                                                             | Stop immediately; preserve; no retry/escalation.                                                                                                                     |
| 3: `human`              | Unresolved product intent, prohibited policy change needed, unmet slice dependency                                                                                                           | Stop; preserve; record required decision; no capacity escalation.                                                                                                    |
| 4: `repairable`         | Actual assertion failure, type/lint diagnostic, valid failing gate verdict caused by implementation, misreported `changed_files`, an out-of-reach or other-layer path the agent can put back | Same-role correction until attempt 3, or until the same rejection comes back verbatim. An out-of-reach path is never escalated: it stops at row 1 instead.           |
| 5: `capacity_exhausted` | Three validated repairable failures at this role, or two consecutive ones that are the same failure                                                                                          | Escalate one rung, or stop/preserve if solver. The unspent attempts are named in the narration and the comment.                                                      |

A failing gate verdict is repairable only while the implementation could
repair it. Each failed step's diagnostic carries its own account of what it
found - a capped tail of the step's captured log, and for `duplicates` both
halves of every clone read out of jscpd's report as
`file:startLine-endLine` - and, when the step names files reliably, the
files it blamed. If every one of those files is a retained acceptance test,
the only bytes that would satisfy the gate are immutable for this turn: the
failure is block 1's defect, not the implementer's, and the run stops at
once as `TESTS_INVALID` (exit 31, `blocked`) naming block 1 and the file,
rather than consuming three corrections and an escalation on it. The rule
is deliberately conservative: a failure naming any non-test file, and any
failure whose files the driver cannot extract, stays row 4.

Coordinated cancellation is a future invariant: it should become a terminal
stop with reason `cancelled`, stop new turns, terminate and reap owned workers
and gate processes, and then record their actual state. The current driver has
no cancellation protocol or `cancelled` outcome. If it is interrupted
externally, its retained record may remain non-terminal; a fresh run refuses
that record, `--resume` reconciles it, and `--reset` archives it. Nothing else
deletes, resets or force-cleans a worktree.

For all slice failures, including external or ownership failures, the affected
loop ends immediately with no retry when its category requires that stop; an
already-running sibling is not cooperatively cancelled and settles its
independent loop before the join reports failures in deterministic order. No
terminal outcome authorizes delivery. Preserve all worktrees, including
successful ones.

Record state changes on the parent story with run/slice identity, role,
attempt, diagnostic category, evidence location and preserved branch/worktree
state. Corrections and escalations keep `in-progress`. Success at this boundary
also keeps `in-progress`: it is not merge or deployment. On terminal failure,
retain `in-progress` and add `blocked` so a fresh picker cannot reuse live
resources. Add `needs-gabriel` and the decision question only for a human
decision. Comment-write failure is external: retain the local terminal record
and report that GitHub was not updated. Never claim the comment succeeded.
Persist a stable transition marker for issue comments and reconcile it before
retrying an uncertain write; do not replay an agent turn to repair reporting.

## Join and delivery boundary

The per-slice success barrier freezes its commit, gate evidence and session.
A successful slice is never rerun while its sibling corrects or escalates, and
a frozen domain slice is not rerun when the UI slice that depends on it merges
it in. A UI slice whose domain sibling never froze is never launched: it keeps
the state delegation left it in, and the report names it as waiting.
The join waits for every slice to reach a terminal state; it releases only
when every slice is `succeeded` and frozen inputs still match. Report outcomes
in domain/UI order regardless of completion order. If failures differ, report
all of them and use the first failed slice in that order as the primary
diagnostic, matching block 1's reporting convention.

This join is the single implementation/gates barrier before delivery. It is
not a new synchronization point inside every parallel correction loop. Before
any implementation push or PR creation, the driver checks the successful join
and unchanged approved commits again. Any later edits invalidate delivery;
do not silently rerun a frozen sibling. How separate changes are integrated,
reviewed and delivered is block 4, below; independent green slices
alone do not establish that their eventual combination passes integration.

## Delivery gates (block 4)

Block 4 has one agent - the reviewer - and the same discipline as blocks 2
and 3: the agent may propose a verdict, but the driver independently
verifies every claim and owns every transition. There is no parallel join
here; the block is sequential, and its barriers are orderings enforced in
code.

### Pre-delivery barrier and integration

Before anything is pushed, the driver re-verifies the block 3 join: every
slice `succeeded`, its worktree clean, and `HEAD` still exactly the frozen
commit. Then it builds one integration branch `story-<n>` in a driver-owned
worktree: created from `origin/main`, then `git merge` of each frozen
implementation commit in domain-then-UI order. Merging - not cherry-picking

- preserves the frozen commits byte-for-byte, so the approved SHAs remain
  the approved SHAs. A merge conflict stops the run with outcome
  `PLAN_REJECTED` and `blocked`: independent green slices that cannot combine
  were not independent, and that needs a revised plan in a new run, never a
  driver-resolved edit. After the merges, every frozen commit must be an
  ancestor of the integration head. The branch is pushed, and exactly one PR
  is opened with `gh pr create`, its body ending `Closes #N`. The PR is the
  run's only delivery vehicle: no stacked per-slice PRs.

### The mechanical predicate

Whether a reviewer runs is a deterministic driver decision recomputed from
the retained signals, never a judgment call at delivery time: the change is
mechanical if and only if every slice's final assignment signals still
select row 4 - complete procedure, `technical_choice="none"`, no sensitive
area, no uncertainty. Diff size and file count do not participate, exactly
as in selection. Anything else - any builder or solver slice, any sensitive
area - is reviewed.

### The reviewer

`workflow/agents.yaml` carries a fifth role, `reviewer` (advanced,
read-only), required by the loader like the other four. The reviewer works
on a driver-created team whose worktree link points at the integration
worktree, and receives the PR's actual diff - computed by the driver from
git, never the PR body's self-description - plus the run's acceptance and
gate evidence.

The reply is strict: exactly `verdict` (`merge` or `fix`) and `findings`;
each finding exactly `file`, `line`, `category`, `required_fix`;
`category` one of `correctness`, `security`, `data-loss`, `concurrency`,
`contract`, `regression-coverage`, `threshold-policy`. A malformed reply is
a contract rejection retried in the same reviewer session, at most three
attempts, like the planner's signals loop; exhaustion is an external-tool
stop, never a guessed verdict. Every finding's `file` must be in the actual
diff - a phantom file is a contract failure. `fix` with no findings and
`merge` with findings are both rejections. Review criteria mirror the
repository's review guidelines: concrete correctness, security, data-loss,
concurrency or contract defects; authorization enforced on the server; no
threshold, snapshot, scanner-policy, container-digest or lockfile change
accepted without justification.

The reviewer is read-only by verification, not by trust: after its turn the
driver asserts the integration worktree is clean at the pushed head. A
reviewer that wrote anything is a contract failure.

### The fix loop

A `fix` verdict is the one sanctioned exit from `succeeded`. Each finding is
routed to its slice by the layer boundaries - a finding outside every slice
is a contract failure. Affected slices, in domain-then-UI order, each take
one fix turn: the same role, session and worktree, the findings as the
diagnostic, then the full block 3 validation (scope, acceptance bytes,
gates) and a new driver-made freeze commit. The slice transitions
`succeeded` → `fixing` → `validating` → `succeeded`; the fix turn is
recorded with kind `review_fix` and does not consume block 3's attempt
budget - the review loop has its own. A fix turn that fails validation
stops the run with `CAPACITY_EXHAUSTED` and `blocked`: the implementer
could not repair the finding under review, and that is a human call, not a
new escalation - the escalation ladder is spent by definition once block 3
succeeded.

After the fixes, the driver merges the new frozen commits into the
integration branch (the superseded commits remain ancestors), pushes, and
re-reviews. Two review rounds are budgeted; exhaustion stops with
`CAPACITY_EXHAUSTED` and `blocked` - a defect the implementer cannot fix
under review is a human call, routed to `needs-gabriel`, not a capability
escalation.

### Claims, CI and merge

The driver never trusts the PR's own state: it runs `gh pr checks` itself
and reads the parsed check list. The required check `all-green` must be
present and successful, and no check may have failed. A missing,
unparsable or pending-past-timeout check state is an external tool failure,
never green.

A red check is judged from its own log before it is retried. The driver
reads the failed jobs' log (`gh run view <run-id> --log-failed`), keeps the
lines that carry an error marker and the repository paths those lines name,
and narrates them under a `🩺` head. What happens next depends only on
what it could read:

- **Located, and a slice of this run owns the file.** The culprits become
  findings (category `ci`, the blaming log lines as `required_fix`) and the
  owning slices each take a CI fix turn through the same machinery a review
  fix uses: the same role, session and worktree, the full block 3
  re-validation - acceptance still passes unmodified, scope, no gate files
  - a new driver-made freeze commit, the join re-merged and pushed. At most
    two such rounds, counted in `delivery.ci_fix_rounds`, a budget of its own
    that neither the review rounds nor the one counted rerun touch - a
    resumed run whose rerun is already spent still gets its fix rounds. Still
    red after both: `CAPACITY_EXHAUSTED` and `blocked`, with the diagnostic
    in the message.
- **Located, but every file it blames is a retained acceptance test.**
  There is no fix turn that could repair it: those bytes are immutable to
  every implementation turn, and moving the file is not a fix turn's work
  either - the retained `test_files` list is what the acceptance run, the
  immutability check and the freeze all read, and a turn that renamed a
  test would leave that list naming a path none of them can find. The run
  stops with `TESTS_INVALID` and `blocked`, naming the test and block 1,
  which is the only place it can still be repaired.
- **Not located** - no repository path in the log at all (an artifact
  upload 403, a lost runner), or only paths no slice of this run owns.
  Nothing may be concluded from a log the driver could not read, so this is
  the flake's case: the failed checks are rerun exactly once (`gh run list`
  - `gh run rerun --failed`, the count persisted in the run record) and the
    driver polls again; a second red stops the run with `CAPACITY_EXHAUSTED`
    and `blocked` - "then investigate" is a human act.

A rerun and a pushed fix are both slow to register, so after either the
driver waits for each failed check to leave its failed state before judging
again: a stale red is not a second failure.

The merge is withheld for one diff: after CI is green and before the merge
command, the driver reads the PR's own diff against main, and a path under
`workflow/` means this pull request changes the driver. A driver that
merges its own code decides unreviewed what it is allowed to do next, so
that merge is Gabriel's: the run labels the story `needs-gabriel`, assigns
him, comments naming the driver files, records
`delivery.held_for_gabriel`, and stops with `NEEDS_GABRIEL` (exit 11). The
PR stays open, every worktree and branch stays in place, and the story is
not `blocked` - nothing here is for a fresh run to retry. The story is
closed by the PR's `Closes #N` when Gabriel merges it; the run's worktrees
are cleaned up with `go.py <n> --reset`.

Otherwise the merge is a fixed command shape - `gh pr merge <n>`, merge
queue, no strategy flag, never update-branch - executed only behind the
pre-merge barrier: the PR exists for this story, its head is the
integration branch's current push, all-green is green after at most one
rerun, and the reviewer verdict (or the mechanical path) is recorded. Merge
unreachability is enforced by code order, not convention. After the merge the driver comments
on the story with the PR and the delivered commits, records the terminal
`DELIVERED`, and continues into block 5 in the same invocation; the story
keeps `in-progress` until block 5's cleanup removes it.

## Ship gates (block 5)

Everything after the merge, in one run, on the same retained record. Each
sub-result is persisted under `delivery.ship` as it settles - `merge_sha`,
`tag`, `main_ci`, `qa`, `flaky`, `prod`, `android`, `cleanup` - so the
record says exactly how far the ship got. A deploy is recorded twice: a
`{started, target, ok: null}` marker before the deploy is invoked, then the
verdict over it, keeping `started`. A run killed between the two has
already moved the symlink on that host, and a record written only on the
way out would say the target was never touched. Nothing here is a retry of blocks
1-4: the merge has landed, so a block 5 failure is reported and the run
stops, never labelled `blocked` for a fresh picker.

`FIT_FLOW_SHIP_TO` is `none`, `qa` or `prod`, and `none` is the default:
the driver never deploys unless told to. Under `none`, block 5 still reads
the merge commit, waits for its tag and for main's own CI to accept it -
the same verification a real deploy would need, and free either way - then
skips straight to cleanup. The release worktree, both deploys, the flaky
wait and the Android build never run; `qa`, `prod` and `android` are each
persisted as `{"skipped": "FIT_FLOW_SHIP_TO=none"}`, and `flaky` is
persisted as decided rather than awaited, the same way `qa` already
decides it without waiting (below). The terminal is still `SHIPPED` and
exit is still 0 - the run completed everything it was configured to do -
and the final comment says plainly that nothing was deployed and how to
opt in.

### The merge commit and its tag

The commit to ship is `gh pr view <n> --json mergeCommit`, not the
integration branch's head: main takes squash merges, so the commit that
landed is one the driver never made. An empty `mergeCommit` on a merged PR
is an external tool failure.

`version-tag.yml` tags that commit on push to main; the driver never tags.
It polls `git ls-remote --tags origin` until a `v*` tag points at the merge
commit, bounded by `FIT_FLOW_MAIN_CI_TIMEOUT`. A poll that fails to read
origin is narrated and retried inside the same deadline rather than counted
as "no tag": a timeout after a failed read is `TOOL_FAILED` saying origin
could not be asked, and a timeout after origin answered is `TOOL_FAILED`
naming `version-tag.yml`. They are different people's problems. An untagged
commit has no version for the build to bake in, and guessing one would ship
a release whose name is a lie.

### Main's own CI

The same acceptance `scripts/deploy/main-ci-gate.ts` applies, recomputed
here rather than delegated to the deploy: a successful `ci.yml` `push` run
on `main` for the merge commit, or a successful `merge_group` run whose
head SHA is that commit, read from `gh run list --workflow ci.yml --commit
<sha>`. The driver polls until one qualifies; a qualifying run that
concludes without success, with no other qualifying, is `TOOL_FAILED`
naming the run's URL. A red main after a merge is a human call.

### The release worktree

Both deploys run from a `release-story-<n>` worktree created by `bun run
worktree:new` (which installs) and hard-reset to the merge commit. The
driver then verifies the worktree's own head is that commit and that it is
clean, because `deploy.ts` names the release directory after `HEAD` and
refuses a dirty tree - a release whose name is not what it contains makes
every later smoke assertion a lie.

### Deploy and smoke

`bun run deploy --tunnel` for QA, `bun run deploy` for production, each
marked started in the record before it is invoked, with `FIT_DEPLOY_HOST`
and `FIT_PUBLIC_ORIGIN` naming the target - the exact
variable names `scripts/deploy/config.ts` reads. `deploy:smoke` is never
run separately: `deploy.ts` already runs it, and the public name's
registration throttle is ten to the hour.

The exit code is not the verdict. The driver reads
`reports/deploy/smoke.json` from the release worktree itself and requires
`ok` true and a passed check named `the live release is this commit` whose
detail names the merge commit. Both deploys run in that one checkout, so
the report is deleted before each of them: a report read after a deploy was
written by that deploy, and a missing one is its own silence rather than
the other deploy's answer. A non-zero exit, a missing report - after a
clean exit as much as after a crash - `ok` false, or a report about some
other commit is `DEPLOY_FAILED` (exit 32):
the story is labelled `needs-gabriel` and assigned, and the comment carries
the target and the report's `failure` string. A failed production deploy
says QA is live. There is no rollback: what is live is what the last
successful activation left, and choosing to go back is Gabriel's.

### The flaky decision

Production is withheld when either signal shows:

- block 4 spent its one counted rerun and the failed job names it reran
  (persisted as `delivery.rerun_failed`) include an `End-to-end` job;
- main's `push` run for the merge commit concluded without success while a
  `merge_group` run for the same commit succeeded - `failOnFlakyTests`
  means a shard that only passed on a retry fails the push run the queue
  run never hit.

An unfinished push run at the timeout is treated as flaky rather than
green. Withholding is not a failure: QA stays live, the run cleans up,
comments that production was withheld and why, and ends `SHIPPED`.
`FIT_FLOW_SHIP_TO=qa` withholds production the same way, by configuration -
and because nothing then reads the flake signal, it is decided from what is
already known (the rerun evidence and the push run's current state) instead
of being waited on, recorded with `"decided": "not awaited: SHIP_TO=qa"`.
Waiting out `FIT_FLOW_MAIN_CI_TIMEOUT` for an answer that gates nothing is
an hour the run spends saying nothing.

### Android

Only after a successful production deploy, and only when
`FIT_FLOW_ANDROID=yes`: `bun run android:release --server-url=<production
origin>` in the release worktree. The build lands inside that worktree,
which cleanup then removes, so the driver copies the APK to
`FIT_FLOW_HOME/releases/<tag>/app-release.apk` and hashes it where it now
lives: the recorded and reported `apk` and `sha256` are that surviving
file's. A copy whose hash is not the one `android:release` printed is a
failed Android release, not a delivery. The toolchain lives on this machine
only, so a failure there says nothing about the deploy that already
succeeded: it is recorded and reported, the run still cleans up and
comments, and only then ends `TOOL_FAILED`. Never a rollback.

### Cleanup and the final comment

Every slice worktree, the integration worktree and the release worktree are
removed with `bun run worktree:done <slug>`. Because main squashes, those
branches are never ancestors of `origin/main` and `worktree:done` would
refuse them, so the driver establishes the same fact by other means before
forcing: the worktree is clean, and its recorded commit is an ancestor of
the integration head the merged PR carried. That head is read from the pull
request itself - `gh pr view <n> --json headRefOid,mergeCommit` - and the
integration worktree is forced only when the PR is `MERGED` and its
`headRefOid` is the commit this run integrated. A local branch still
pointing at that commit proves only that nobody moved it. `--force` then bypasses exactly
the refusal the driver has already answered; the local branch is deleted
separately, and only when its tip is still the sha the record names. A
worktree whose status cannot be read is not a clean one: a failed `status`
prints nothing, and forcing on that silence destroys work nobody has seen,
so it is preserved and reported with the reason the read failed. A refusal
the driver cannot answer this way is `TOOL_FAILED` - after the final
comment, never before. A target that was proven landed and removed also
loses its branch on origin (`git push origin --delete <slug>`, recorded in
`cleanup.remote_deleted` as the slug and the commit it was deleted at, the
only trace left of it): the worktree and the local branch are gone, so
origin holds the last copy of something nothing will use again. A preserved
worktree keeps its remote branch - that is the audit trail.

Each child (slice) issue is closed with `Delivered in PR #n (tag vX.Y.Z)`,
and the `in-progress` label comes off the story, whose own closure was the
PR's `Closes #N`. The final comment on the story names the PR and merge
commit, the tag, each deploy target with its smoke result or the reason it
was withheld, the Android outcome, what was cleaned up, and the next step.
The terminal `SHIPPED` is persisted only after that comment succeeds; a
crash off the beaten path persists `TOOL_FAILED`. Success is exit 0.

An external Codex/Claude operator may select the story, start the driver and
observe its reported progress/result. It cannot change prompts, configuration,
the workflow or slice worktrees while the run is active. Until coordinated
cancellation exists, interrupting the process is an external stop that leaves
retained state, not a clean driver transition; `--resume` is how that state
is taken up again. A workflow bug requires stopping and preserving this run,
fixing the workflow separately with tests, then `--resume`: the fixed driver
re-derives the stopped turn's verdict from the bytes it left. This
non-interference rule is a launch/turn invariant, not a second state machine
or a requirement for a continuous supervisor.

## Resume and reset

`go.py <n> --resume` continues a story's retained run. It picks the story
only if it is open, a `story`, and under no human hold (`needs-gabriel`,
`paused`); the run's own marks, `in-progress` and `blocked`, do not stop it,
and `blocked` comes off as the run takes the story back. It takes the story
lock, loads `runs/story-<n>.json`, and decides where the flow continues:

| record says                                     | continue at                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| terminal `SHIPPED`                              | nowhere: `CANNOT_PICK`                                                                                        |
| a PR number, and GitHub says it is merged       | block 5, on that merge commit; a deploy recorded live is not repeated                                         |
| a PR number, and it is neither open nor merged  | nowhere: `RUN_STATE_CONFLICT`, reset                                                                          |
| a slice with no accepted assignment             | block 2, on the failing tests block 1 pushed; every slice must be unlaunched                                  |
| any slice not `succeeded`                       | block 3, after each such slice is reconciled (next table)                                                     |
| every slice `succeeded`, terminal `IMPLEMENTED` | block 4; a retained integration branch and PR are reused at their recorded head, and a `merge` verdict stands |
| every slice `succeeded`, any other terminal     | block 3's report, then block 4                                                                                |

Each slice not yet frozen is put back where its last turn actually reached.
These are the only transitions out of `failed`, and they exist because
`failed` records the driver's own judgement, which a fixed driver may
re-derive:

| the slice's last turn                                          | reconciliation                                                                                                                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no turn at all (the launch barrier failed)                     | `assigned`; the loop launches attempt 1                                                                                                                                                                  |
| status `running` (the driver died mid-turn)                    | refused (`EXECUTION_HELD`) while an `aarmy talk` for that team and role still runs on this machine; otherwise voided                                                                                     |
| completed with a valid reply (validation stopped or never ran) | the working tree's digest must equal the one recorded when the turn ended, else `RUN_STATE_CONFLICT`; then `running` with its verdict pending, and block 3 re-validates that reply without an agent call |
| completed and marked `"repeated": true`                        | refused (`RUN_STATE_CONFLICT`): the verdict is a function of bytes that have not changed, so re-validating could only reach the same diagnostic and stop on it again; reset                              |
| completed without a reply (launch failed, reply malformed)     | voided                                                                                                                                                                                                   |
| already voided by an earlier resume                            | back to the launch                                                                                                                                                                                       |
| a review fix, or state `fixing`/`escalating`                   | refused (`RUN_STATE_CONFLICT`): reset                                                                                                                                                                    |

Voiding keeps the ledger entry (status `completed`, result `void`, the reason
in `why`), decrements `attempts` by one, and returns the slice to `assigned`
(no attempt at this revision yet) or `correcting`; the relaunch reserves the
same attempt number under the same role, revision and session, so the
bounded budget and the session rules hold exactly as for a first run. A
voided first attempt relaunches on whatever the dead turn left in the
worktree: accumulated work, like an escalation's.

A dependent UI slice's sibling merge is reconciled by block 3 itself rather
than by these tables, because the step is the same one a fresh run takes and
it is idempotent: a UI slice whose branch already carries the recorded
sibling commit skips it, and one whose domain sibling is frozen without that
merge goes through it before its loop launches.

`go.py <n> --reset` undoes what a run created so a fresh run can begin, and
is the one deliberately destructive command. Under the story lock it closes
an open PR (a merged one is left: its work landed), removes each slice,
integration and release worktree after narrating its status, deletes their
local and remote branches, deletes the AI Army teams, closes the child issues
(from the record, or by the `Part of #<n>` line when there is no record),
removes `in-progress` and `blocked` (never `needs-gabriel` or `paused`), and
archives the record as `runs/story-<n>.<stamp>.reset.json`. It comments on
the story with everything it undid. It refuses (`EXECUTION_HELD`) while a run
owns the story.

## Configuration boundary

`workflow/agents.yaml` remains the sole source for backend, model and effort.
The loader requires planner, mechanic, builder, solver and reviewer entries
before any side effects, including roles that might only be reached by
escalation or only run at delivery. Keep exact keys, explicit nonempty values and backend-specific
effort validation. No default model or fallback to a different role is allowed.
Capacity labels describe responsibility, not a hardcoded model family; changing
the configured model requires a new execution.

The seeded configuration (planner `opus`/`low`, mechanic `haiku`/`medium`,
builder `opus`/`low`, solver `opus`/`high`, reviewer `opus`/`medium`) is what
four real runs of #399 argued for; the values are configuration, not code.

Block 5's deploy targets follow the same rule, and `scripts/deploy/config.ts`
already states why: the machines are infrastructure Gabriel owns, so they
arrive in the environment and nothing in this repository names them.
`FIT_FLOW_SHIP_TO` is `none` (the default), `qa` or `prod`. Under `none`
none of `FIT_FLOW_QA_DEPLOY_HOST`, `FIT_FLOW_QA_PUBLIC_ORIGIN`,
`FIT_FLOW_PROD_DEPLOY_HOST` or `FIT_FLOW_PROD_PUBLIC_ORIGIN` are required -
there is nothing to deploy to. `FIT_FLOW_QA_DEPLOY_HOST` and
`FIT_FLOW_QA_PUBLIC_ORIGIN` are required under `qa` and `prod` alike;
`FIT_FLOW_PROD_DEPLOY_HOST` and `FIT_FLOW_PROD_PUBLIC_ORIGIN` are required
only under `prod`. `FIT_FLOW_ANDROID` (`yes` by default) decides whether
the APK is built, and is irrelevant under `none`. All of them are
validated where the agent roster is - at startup, before any side effect -
and a missing one is a configuration error naming the variable, exit 2.
There is no default host: guessing a deployment target is worse than
stopping.
