# Delegation and implementation gates

Status: implemented for blocks 1-5's boundaries - selection, assignment,
pre-launch barrier, bounded repair loops, one-rung escalation, the final
join and the ordinary stop/preserve rules, the delivery gates (push, PR,
review, merge) and the ship gates (tag, main CI, deploy, smoke, the flaky
decision, android, cleanup) - as of the driver behind `go.py`.
The recovery/resume
and coordinated-cancellation clauses remain future: `go.py` stops and
preserves instead of resuming, while an external process interruption may
leave a deliberately uncertain retained record. This page distinguishes
implemented behavior from those target invariants; behavioral changes belong
in the driver and its tests.

## Inputs and ownership

The driver retains block 1's ordered list of one or two slices (`domain`, then
`ui` when both exist). Each slice already has an issue number, brief, acceptance
criteria, test kind, failing test paths, branch, worktree and team. Block 2
must reuse those identities. It does not split again, create replacement issues
or worktrees, or ask a worker to rediscover the brief.

Before delegation the driver must retain an immutable record of these inputs,
the validated failing-test commit, the repository base commit, and the exact
agent configuration loaded at startup. These are proposed retained records,
not fields currently persisted by block 1. Evidence points to that record or
to repository content at the recorded commit; mutable issue text is not enough.

The driver owns classification, validation and transitions. An agent may
extract signals or propose evidence, but a role name or a claim that tests
passed is never the verdict. Work is confined to the assigned worktree, with
no writes to its sibling or the shared checkout. Workflow source, prompts,
agent configuration and gate policy cannot be changed during this run.

Before the failing-test commit is accepted, the driver validates it as what
it will become: an immutable input. It runs the repository's change-scoped
lint over the branch (`bun run lint:changed`); a lint failure returns a
precise, repairable diagnostic (outcome `TESTS_INVALID`, exit 31) to the
same mechanic retry loop and never reaches implementation. It also rejects
lint suppression directives (`eslint-disable`, `eslint-enable`,
`@ts-ignore`, `@ts-expect-error`) inside acceptance tests outright: a
directive that is only satisfied before the implementation exists, such as
suppressing `no-unsafe-assignment` on a dynamic import of a module that does
not exist yet (#377), turns into an unfixable lint break the moment the
implementation lands, and an implementation worker cannot legally fix it.
Consequently the mechanic must write assertions that lint clean both before
and after the behavior exists (for a missing module: dynamic import through
the promise chain with `unknown`-typed binding, not suppression).

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

Two slices must be independently testable against their recorded inputs.
If UI requires its sibling's unpublished implementation to pass its acceptance
tests, delegation stops with an unmet dependency; it must not wait forever,
invent a mock that replaces the acceptance boundary, or copy sibling changes.
That dependency needs a revised plan in a new run. This is the conservative
boundary of the parallel policy, not permission to invent integration behavior.

Before every turn, verify exclusive ownership, unchanged driver/configuration,
current assignment, expected branch and worktree, absence of another active
worker, and the previous turn's settled result. Corrections may start with the
previous turn's dirty implementation; the initial launch must start clean.
Only one turn or validation runs per slice at a time.

After every turn, the driver independently checks the returned structure,
actual diff scope and branch identity, acceptance behavior, and the applicable
foreground pre-push checks in `QUALITY.md`. Acceptance tests retained from
block 1 must execute and pass; removing, skipping, weakening or replacing their
assertions is a contract failure. New regression tests may be added. Gate
reports must belong to this turn's actual content and requested commands,
contain every required result and valid artifacts, and have passing exits.
Missing reports, runner crashes or stale reports cannot be treated as failed
assertions or as success. No full local CI tier is implied.

The driver determines affected specs, e2e files and mutation lanes from the
actual diff under the recorded policy, not just the agent's reported files.
That diff is the complete delta of the branch and worktree against the
retained failing-test commit, recomputed at every validation: a prohibited
gate, threshold, suppression-baseline, lockfile or workflow change (#379)
cannot be hidden by the timing of a retry commit or an uncommitted edit.
Any local commit happens under driver control before final validation; a
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

| From             | Condition/action                                                                  | To           |
| ---------------- | --------------------------------------------------------------------------------- | ------------ |
| `assigned`       | Launch gate passes; reserve attempt 1                                             | `running`    |
| `running`        | Worker ends normally with a valid reply                                           | `validating` |
| `validating`     | All independent checks pass at the recorded commit                                | `succeeded`  |
| `validating`     | Repairable failure and attempt less than 3                                        | `correcting` |
| `correcting`     | Same role, identity, session and worktree; reserve next attempt                   | `running`    |
| `validating`     | Repairable failure at attempt 3, role below solver                                | `escalating` |
| `escalating`     | Immediate next role, matching frozen configuration, new revision and attempt zero | `assigned`   |
| `validating`     | Repairable failure at attempt 3 on solver                                         | `failed`     |
| Any active state | External failure, contract violation or required human decision                   | `failed`     |

Escalation preserves issue, team, branch, worktree, brief and accumulated
implementation. The old role's worker must have ended. The next role uses its
own identity/session within that team, receiving the original brief and all
prior diagnostics. Never silently reuse a lower role's backend session with
different model settings. If the harness cannot guarantee session identity,
stop as a tool failure. Corrections within a role always reuse its session.

All unlisted transitions are prohibited. In particular: no downgrade, skipped
rung, early escalation based on an agent's self-assessment, fourth turn at one
role, or automatic transition out of `succeeded` or `failed`. Exhaustion is the
only capacity escalation trigger. A request for a stronger model still needs
the normal independent diagnostic and correction budget.

Persist a turn identity before launching and its completion before choosing
the next transition. Duplicate completion for the same identity is a no-op;
conflicting completion is a contract failure. An interrupted process may
resume only after proving exclusive ownership and reconciling the exact
worker/session and retained input. A known completed turn resumes validation
without another agent call; a known running turn is observed, never relaunched.
An assignment or correction with no reserved turn may proceed normally.
An uncertain launch/completion, changed bytes, missing session, or interrupted
gate without a trustworthy completed report stops and preserves the worktree.
It does not reset counters. Recovery mechanisms are future implementation;
current `go.py` provides no such resume contract.

## Failure decisions and issue record

Classify from driver evidence in the precedence below. If a tool failure
prevents establishing a code defect, report the tool failure. Workers cannot
choose their own retry category.

| Precedence and type     | Examples                                                                                                         | Action                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1: `contract`           | Malformed assignment/reply, escaped worktree, changed workflow, weakened acceptance or policy, identity mismatch | Stop immediately; preserve; no retry/escalation.                  |
| 2: `external`           | Authentication, network, launch, unavailable tool, timeout, crash, missing/invalid runner report                 | Stop immediately; preserve; no retry/escalation.                  |
| 3: `human`              | Unresolved product intent, prohibited policy change needed, unmet slice dependency                               | Stop; preserve; record required decision; no capacity escalation. |
| 4: `repairable`         | Actual assertion failure, type/lint diagnostic, valid failing gate verdict caused by implementation              | Same-role correction until attempt 3.                             |
| 5: `capacity_exhausted` | Three validated repairable failures at this role                                                                 | Escalate one rung, or stop/preserve if solver.                    |

Coordinated cancellation is a future invariant: it should become a terminal
stop with reason `cancelled`, stop new turns, terminate and reap owned workers
and gate processes, and then record their actual state. The current driver has
no cancellation protocol or `cancelled` outcome. If it is interrupted
externally, its retained record may remain non-terminal; a new run refuses that
record and requires manual audit. Do not delete, reset or force-clean
worktrees.

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
A successful slice is never rerun while its sibling corrects or escalates.
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
never green. On red, the driver reruns the failed checks exactly once
(`gh run list` + `gh run rerun --failed`, the count persisted in the run
record) and polls again; a second red stops the run with
`CAPACITY_EXHAUSTED` and `blocked` - "then investigate" is a human act.

The merge is a fixed command shape - `gh pr merge <n>`, merge queue, no
strategy flag, never update-branch - executed only behind the pre-merge
barrier: the PR exists for this story, its head is the integration branch's
current push, all-green is green after at most one rerun, and the reviewer
verdict (or the mechanical path) is recorded. Merge unreachability is
enforced by code order, not convention. After the merge the driver comments
on the story with the PR and the delivered commits, records the terminal
`DELIVERED`, and continues into block 5 in the same invocation; the story
keeps `in-progress` until block 5's cleanup removes it.

## Ship gates (block 5)

Everything after the merge, in one run, on the same retained record. Each
sub-result is persisted under `delivery.ship` as it settles - `merge_sha`,
`tag`, `main_ci`, `qa`, `flaky`, `prod`, `android`, `cleanup` - so the
record says exactly how far the ship got. Nothing here is a retry of blocks
1-4: the merge has landed, so a block 5 failure is reported and the run
stops, never labelled `blocked` for a fresh picker.

### The merge commit and its tag

The commit to ship is `gh pr view <n> --json mergeCommit`, not the
integration branch's head: main takes squash merges, so the commit that
landed is one the driver never made. An empty `mergeCommit` on a merged PR
is an external tool failure.

`version-tag.yml` tags that commit on push to main; the driver never tags.
It polls `git ls-remote --tags origin` until a `v*` tag points at the merge
commit, bounded by `FIT_FLOW_MAIN_CI_TIMEOUT`. A timeout is `TOOL_FAILED`
naming `version-tag.yml` - an untagged commit has no version for the build
to bake in, and guessing one would ship a release whose name is a lie.

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

`bun run deploy --tunnel` for QA, `bun run deploy` for production, with
`FIT_DEPLOY_HOST` and `FIT_PUBLIC_ORIGIN` naming the target - the exact
variable names `scripts/deploy/config.ts` reads. `deploy:smoke` is never
run separately: `deploy.ts` already runs it, and the public name's
registration throttle is ten to the hour.

The exit code is not the verdict. The driver reads
`reports/deploy/smoke.json` from the release worktree itself and requires
`ok` true and a passed check named `the live release is this commit` whose
detail names the merge commit. A non-zero exit, a missing report, `ok`
false, or a report about some other commit is `DEPLOY_FAILED` (exit 32):
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
`FIT_FLOW_SHIP_TO=qa` withholds production the same way, by configuration.

### Android

Only after a successful production deploy, and only when
`FIT_FLOW_ANDROID=yes`: `bun run android:release --server-url=<production
origin>` in the release worktree, with the APK path and sha256 the script
prints recorded. The toolchain lives on this machine only, so a failure
there says nothing about the deploy that already succeeded: it is recorded
and reported, the run still cleans up and comments, and only then ends
`TOOL_FAILED`. Never a rollback.

### Cleanup and the final comment

Every slice worktree, the integration worktree and the release worktree are
removed with `bun run worktree:done <slug>`. Because main squashes, those
branches are never ancestors of `origin/main` and `worktree:done` would
refuse them, so the driver establishes the same fact by other means before
forcing: the worktree is clean, and its recorded commit is an ancestor of
the integration head the merged PR carried. `--force` then bypasses exactly
the refusal the driver has already answered; the local branch is deleted
separately, and only when its tip is still the sha the record names. A
refusal the driver cannot answer this way is `TOOL_FAILED` - after the
final comment, never before.

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
cancellation exists, interrupting the process is an external stop that may
leave retained state requiring audit, not a clean driver transition. A
workflow bug requires stopping and preserving this run, fixing the workflow
separately with tests, then starting a new clean execution. This
non-interference rule is a launch/turn invariant, not a second state machine
or a requirement for a continuous supervisor.

## Configuration boundary

`workflow/agents.yaml` remains the sole source for backend, model and effort.
The loader requires planner, mechanic, builder, solver and reviewer entries
before any side effects, including roles that might only be reached by
escalation or only run at delivery. Keep exact keys, explicit nonempty values and backend-specific
effort validation. No default model or fallback to a different role is allowed.
Capacity labels describe responsibility, not a hardcoded model family; changing
the configured model requires a new execution.

The seeded configuration (`haiku`/`low`, `haiku`/`low`, `sonnet`/`medium`,
`opus`/`high`) follows the suggested capacity defaults; the values are
configuration, not code.

Block 5's deploy targets follow the same rule, and `scripts/deploy/config.ts`
already states why: the machines are infrastructure Gabriel owns, so they
arrive in the environment and nothing in this repository names them.
`FIT_FLOW_QA_DEPLOY_HOST` and `FIT_FLOW_QA_PUBLIC_ORIGIN` are required
whenever block 5 can run; `FIT_FLOW_PROD_DEPLOY_HOST` and
`FIT_FLOW_PROD_PUBLIC_ORIGIN` are required when `FIT_FLOW_SHIP_TO=prod`
(the default). `FIT_FLOW_SHIP_TO=qa` stops after QA, and `FIT_FLOW_ANDROID`
(`yes` by default) decides whether the APK is built. All of them are
validated where the agent roster is - at startup, before any side effect -
and a missing one is a configuration error naming the variable, exit 2.
There is no default host: guessing a deployment target is worse than
stopping.
