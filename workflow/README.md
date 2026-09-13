# workflow

The user starts `go.py` manually. It is intended to become the autonomous,
maximally deterministic driver for Fit_'s complete
[development flow](../docs/development-flow.md): issue selection, planning,
implementation, gates, review, CI, merge, deploy and reporting. No external
Codex or Claude Code session is required to supervise or continuously monitor it. Agents
invoked through `aarmy` are bounded workers under the Python driver's control;
their replies must match JSON schemas.

The [delegation and implementation gates](delegation-contract.md) are
implemented for blocks 1-5: role selection, pre-launch validation, bounded
repairs, escalation, the final all-slice barrier, delivery (integration
branch, PR, review, CI, merge - withheld for a change to the driver itself),
and ship (the merge commit's tag, main's own CI, the QA deploy, the flaky
decision, the production deploy, the Android release and cleanup). An
optional external operator may start and observe a run, but cannot mutate the
workflow or worktrees while it runs. A stopped or interrupted run leaves its
retained record and worktrees in place; `go.py <n> --resume` continues it
from the exact point its last turn reached (never replaying a turn that
ended, never relaunching beside one still running), and `go.py <n> --reset`
undoes what it created and archives the record. Coordinated cancellation is
not implemented: an interruption is an external stop that `--resume`
reconciles afterwards.

Blocks 1-5 run in one `go.py` invocation. Block 1 runs every command and
check itself, calling agents only at the judgment boxes ("whose call?",
"spans domain and UI?") and to write the failing tests. Block 2 asks the
planner to extract each slice's nine capability signals with evidence, then
the driver itself decides the rung (mechanic, builder or solver) from the
precedence table. Block 3 runs one bounded implementation loop per slice -
in parallel when the two slices are independent, and domain first then UI
when the UI slice depends on its domain sibling; after every turn the driver
independently validates scope, branch
identity and acceptance behavior and then runs the repository's own
diff-sized pre-push gate (`bun run verify:changed`) in the slice worktree,
whose plan derives the affected specs, e2e files and mutation lanes from the
actual diff under the repo's dependency and route mapping. A judged failing
step (exit 1) retries in the same role, with the step's own account of what
it found - a capped tail of its captured log, and for `duplicates` both
halves of every clone as `file:startLine-endLine`, read out of jscpd's
report - not merely the failed step's name. When every file a failed step
blames is one of the retained acceptance tests, the turn cannot repair it
at all (those bytes are immutable) and the run stops at once as
`TESTS_INVALID`, naming block 1 and the file, instead of spending three
corrections and an escalation on it; a failure naming any other file, or
one whose files the driver cannot extract, stays an ordinary repairable
diagnostic. A crash, missing, stale or
inconsistent gate report stops at once. The scope check puts the gates the
agent is judged by out of reach - anything under `quality/`, `.github/`,
`scripts/ci/`, `scripts/deploy/`, `scripts/github/`, `scripts/quality/` or
`scripts/security/`, plus the snapshots, the lockfiles, the tool
configuration and `agents.yaml` - and the implementer's brief renders that
list from the same constant the check reads, so the two cannot drift. Only
those script folders: the rest of `scripts/` is the application's own
tooling, which a story may be about (#337). Neither is the driver's own
code out of reach: an agent may implement a change under `workflow/`,
because it edits a worktree copy while the running driver is the main
checkout's code, and the driver's suite is CI's own "Workflow driver" job.
Block 4 never merges such a change (below). Reaching into a path that is
out of reach, or into the other layer, costs a correction rather than the
run: the driver names the offending paths and asks the same agent to put
them back, and only a budget that ends with the change still there stops as
`AGENT_BROKE_CONTRACT`. The driver
commits, freezes and joins at the final barrier; agents never commit or
push. Every agent turn carries the session id the AI Army CLI printed, and the driver persists it
with the turn: corrections must come from the same session, an escalated
role must establish a new one, and a changed, missing or reused session id
stops the run. Before every turn the driver also re-verifies that the AI
Army team's worktree link still resolves to exactly the retained slice
worktree before launching anything.

Slicing is strictly binary. `ui` means frontend/interface work in Svelte
components and routes, normally browser-tested. `domain` means every non-UI
change, including framework-free logic, server/backend code, persistence,
migrations and database work. A story gets one slice when it is wholly in
either category, or exactly two ordered slices—domain then UI—when it spans
both. There is never a third layer.

The driver creates child issues, worktrees and teams sequentially. A one-slice
story then runs one mechanic. A two-slice story runs its domain and UI mechanics
concurrently, each in its already-created isolated worktree/team. The driver
waits for every mechanic and validation to settle, reports failures in slice
order, and advances only if every slice succeeds. A successful sibling remains
available for recovery when another slice fails.

A UI slice usually renders what its domain sibling supplies, so its acceptance
tests cannot pass before that implementation exists. The planner says so with
`needs_sibling`, and for the UI slice of a two-slice story the driver accepts
it instead of rejecting the plan: block 3 runs the domain loop first, then
merges the frozen domain commit into the UI branch itself, pushes it, checks
that the UI acceptance tests still fail on the merged tree, and only then
launches the UI loop. The dependency never runs the other way - a domain slice
that depends on the UI slice, a circular pair, and a one-slice story that
claims a sibling are all rejected plans - and a domain slice that never freezes
leaves the UI slice unlaunched.

Each slice has one initial mechanic turn plus at most two corrective turns—three
total. Corrections reuse the same mechanic identity, AI Army team/session,
branch and worktree. After every turn, the driver reruns the complete
independent validation. It retries only repairable test-work failures such as
dirty work, work that has not been pushed, file mismatches, non-test changes,
missing or unrun tests, or tests that pass. Agent-launch, authentication, network, runner-output
and other tooling/infrastructure failures stop immediately. A corrective prompt
quotes the concrete diagnostic and permits changes only to the acceptance
tests. Parallel slices run these retry loops independently; the barrier advances
only after every loop succeeds.

Vitest acceptance specs may define ordinary test helpers, but a spec with no
product import is rejected when it defines a callable locally and asserts that
callable as a stand-in for the missing product boundary. A failed Vitest file
is accepted only when at least one assertion actually ran and failed; import,
collection and setup failures do not count as a missing-behavior test. For a
future module that does not exist yet, the mechanic is instructed to put a
dynamic import and export call inside the assertion promise instead of adding
a stub. Every changed test must also match the slice's requested runner:
Playwright slices change only `*.e2e.ts`; Vitest slices may change only test
files that are not `*.e2e.ts`.

Because the failing tests become immutable implementation inputs, the driver
validates them in block 1 as what they will be: the branch must pass the
repository's change-scoped lint (`bun run lint:changed`, repairable by the
mechanic until the diagnostic is clean), its type lane (`bun run check`) and
the repository gate's own content steps
(`bun scripts/quality/gate.ts verify:fast --only duplicates,format:check,check:suppressions`) -
the steps block 3 will run over these same bytes once nobody can change
them, so a ten-line clone inside an acceptance test is caught while the
mechanic still owns the file rather than failing six implementation
attempts (#397),
and acceptance tests carry no lint suppression at all (`eslint-disable`,
`@ts-ignore`, `@ts-expect-error` are rejected). A playwright spec must exercise a component through the
repository-owned harness route `/dev/component-harness` (see
`src/routes/dev/component-harness/+page.svelte`); importing product code
inside `page.evaluate` is rejected the same way a self-invented route
fixture is - production files stay off-limits to the mechanic. The harness
is a test-only surface: the web server 404s `/dev/` without the
`FIT_COMPONENT_HARNESS=yes` runtime flag and the Capacitor build refuses it
outright, so it never mounts a component in the shipped app.

Failing is not enough either. The driver reads every failed test's error
message out of the runner's JSON report and requires a failed expectation: a
test that throws - a helper called with an argument of the wrong type
(#399), an undefined name, a syntax error - can never pass however the
behavior is implemented, so it comes back to the mechanic as
`TESTS_INVALID` quoting the file, the test title and the runner's own
message. The same reading runs during implementation: a still-failing
acceptance test's diagnostic names each failed test and its message, and a
throw raised inside the acceptance test or a test helper stops the run with
`TESTS_INVALID` attributed to block 1 rather than spending the
implementer's corrections on a test nothing can satisfy.

The planner's signals turn is also a bounded loop: an initial reply plus at
most two corrective retries in the same planner session. A malformed
evidence reference or an unknown signal is sent back with the exact
validation diagnostic and the whole reply is revalidated; infrastructure and
schema-shaped-but-external failures are not retried, and exhausted retries
keep the truthful `PLAN_REJECTED` terminal. Continuity is enforced, not
asked for: a corrective attempt whose CLI session differs from the first
turn's stops the run (`TOOL_FAILED`) instead of grading a fresh conversation.

Before either planner judgment, the driver fetches the issue title, body,
labels, comments and the important timeline-event types that the GitHub adapter
supports reliably. It selects and normalizes that evidence with deterministic
rules into a stable chronological representation; agents do not browse GitHub
or supplement it themselves. Ordinary issues pass this complete normalized
context directly to the planner. No context-summarizer agent is called today.

A future, conditional path is planned for issue context above an objective size
threshold. The driver would ask a dedicated context-summarizer agent to organize
the older evidence, validate its structured reply, and give the planner that
synthesis together with preserved current and recent evidence. That entire path
is not implemented. Its output would be an aid for navigating evidence, never a
requirements decision or an authority over the source issue.

Read `go.py` top to bottom: each line is a box or a diamond of the diagram.

## How to run

### What you need, once

| tool         | check it with         | why                                          |
| ------------ | --------------------- | -------------------------------------------- |
| `uv`         | `uv --version`        | runs the driver and its tests                |
| `gh`         | `gh auth status`      | reads and writes issues on `Gabes-Tint/Fit_` |
| `aarmy`      | `aarmy doctor`        | talks to the agents                          |
| `claude`     | `claude --version`    | the backend used by the seeded configuration |
| `bun`, `git` | from `.tool-versions` | `bun run worktree:new`, running test files   |

Then install the driver's environment:

```sh
cd workflow
uv sync
```

### Configure the agents

[`agents.yaml`](agents.yaml) beside `go.py` is the source of truth for all
four roles: planner, mechanic, builder and solver. All four are required
before any side effect - including roles a run might only reach by
escalation.

```yaml
planner:
  backend: claude
  model: opus
  effort: low
mechanic:
  backend: claude
  model: haiku
  effort: medium
builder:
  backend: claude
  model: opus
  effort: low
solver:
  backend: claude
  model: opus
  effort: high
```

Edit the three values under a role to change its harness, model or reasoning
effort. The driver resolves this file relative to its own source, not the
shell's current directory, and validates it before any GitHub write, worktree
creation or agent turn. All four roles and all three keys are required;
unknown roles or keys are errors. AI Army allows a model flag to be omitted,
but this driver requires an explicit non-empty model so a run never inherits
a changing backend default.

`backend` uses AI Army's exact identifiers. The locally installed registry
supports `claude`, `codex`, `grok` and `opencode`: the human product name Claude
Code maps to `claude`, for example. Those are representative installed harnesses,
not aliases invented by this workflow. Claude's installed CLI has the closed
effort set `low`, `medium`, `high`, `xhigh`, and `max`, which the driver validates
for the `claude` backend. AI Army intentionally passes effort through for the
other registered backends, whose model/provider controls the accepted value, so
the driver requires a non-empty string without inventing a universal list.

Corrective and corrective-after-escalation turns keep the run's frozen
startup configuration (a mid-run `agents.yaml` edit never touches an
in-flight slice) and reuse the same AI Army team, branch and worktree;
escalation to a new role starts that role's own session within the same
team. The run holds an exclusive flock on the story
(`~/.agents-army/fit_/workflow/locks/story-<n>.lock`) for its whole life, so
a second execution fails without starting workers, and it persists its
lifecycle state under `~/.agents-army/fit_/workflow/runs/story-<n>.json` for
audit. There is no resume contract: a fresh run after a killed one stops
rather than replaying anything.

### It acts for real

A run labels and comments on real issues, may create child issues, creates
worktrees under `.claude/worktrees/`, pushes branches, and spends real agent
turns using the planner and mechanic configured in `agents.yaml`. There is no dry-run mode.
To watch it work with nothing real touched, run the tests instead (below).

### Run it

```sh
cd workflow
uv run go.py 351                  # plan, delegate and implement issue #351
uv run go.py                      # pick the lowest-numbered open story not held
uv run go.py 351 --resume         # continue #351's stopped run where it left off
uv run go.py 351 --reset          # undo what a run created for #351, archive its record
FIT_FLOW_SHIP_TO=qa uv run go.py 351    # ...and also deploy to QA
FIT_FLOW_SHIP_TO=prod uv run go.py 351  # ...and also deploy to QA, then prod
```

From the repository root: `uv run --project workflow workflow/go.py 351`.

| argument   | what                                                                                                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue`    | the story to pick; without it, the lowest-numbered open story not held                                                                                                                                                                                                                                            |
| `--resume` | needs `issue`. Continues the story's retained run: a turn that ended with a valid reply is re-validated on the bytes it left (no new agent call); a turn that died or failed before replying is voided and relaunched under the same attempt number; block 2, 4 and 5 re-enter from what the record already holds |
| `--reset`  | needs `issue`. Removes the slice, integration and release worktrees and their local and remote branches, deletes the teams, closes an open PR and the child issues, drops `in-progress` and `blocked`, and archives `runs/story-<n>.json` as `runs/story-<n>.<stamp>.reset.json`. Destructive on purpose          |

"Held" means labelled `in-progress`, `blocked`, `needs-gabriel` or `paused`.
Exit 0 means the whole flow ran: every slice implemented and validated, and
the PR merged. `FIT_FLOW_SHIP_TO=none`, the default, never deploys - block 5
still verifies the merge commit's tag and main's CI, then cleans up. Set
`FIT_FLOW_SHIP_TO=qa` or `FIT_FLOW_SHIP_TO=prod` to have it deploy what it
merged.

### What you will see

The run narrates itself as it goes, and saves the same text to
`~/.agents-army/fit_/workflow/logs/issue-<n>/<timestamp>.log`:

```text
📋 Picked #140 "Sync payload"
🏷️  Labels: story
🤖➡️  planner (claude · haiku · low)
   │ # Planner: whose call?
   │ …the whole prompt…
🤖⬅️  planner replied in 41s
   │ Owner:          orchestrator
   │ Reason:         ordinary work
🔀 Whose call? → 🧑‍💻 orchestrator's
🔀 Spans domain and UI? → ✂️ yes, split into 2
🔍 Verify #1000: tree clean ✔ · pushed ✔ · files on branch ✔ · only tests ✔ · lint ✔
🧪 src/lib/merge.spec.ts → failed, as it should ✔
🏁 Planned #140 → #1000 domain, #1001 ui · next: block 2, delegate
🧭 Signals for domain: …the nine values…
🎯 #1000 (domain) → mechanic · Selection row 4: …
🚦 Pre-launch barrier
   │ #1000 (domain) mechanic · clean at 7030127… · pushed ✔ · tests ✔
⚡ Starting 2 implementation loops in parallel
🔧 Mechanic #1000 (domain) attempt 1/3
🤖⬅️  mechanic replied in 34s
📦 Validating #1000 (domain)
🔍 Verify #1000: scope ✔ · acceptance pass ✔ · branch identity ✔ · no gate files ✔
🔒 #1000 (domain) frozen at 485e7af…
⏳ Implementation barrier: all 2 slices settled
🏁 Implemented #140 → #1000 domain (mechanic, 485e7af…) · next: block 4, review
```

When the UI slice depends on the domain slice, the two loops are ordered
instead of parallel and the driver's own merge sits between them:

```text
⛓️ #1001 (ui) depends on the domain slice and runs after it
⛓️ #1001 (ui) waits for #1000 (domain)
🔒 #1000 (domain) frozen at 485e7af…
⛓️ Bringing #1000 (domain) 485e7af… into #1001 (ui)
⇪ Pushed story-1001-ui at 9c4d1b0…
🧪 src/routes/rows.e2e.ts → still failed on the merged tree, as it should ✔
🔧 Mechanic #1001 (ui) attempt 1/3
```

Block 4 narrates what CI said before it decides what to do about it. A red
check whose log names a file one of the slices owns buys a fix turn; one
that names nothing the driver can act on gets the one counted rerun:

```text
🩺 CI is red: Unit and component coverage
   │ ERROR: Coverage for lines (0%) does not meet global threshold (80%) for src/lib/LogRow.ts
🛠 CI fix round 1/2 on PR #418: src/lib/LogRow.ts
🛠 Findings routed to slices: ui
⇪ Pushed fixes; integration head 9c4d1b0…
🟢 CI green on PR #418 (7 checks)
```

`🛑` marks a planned stop (for example, the call is Gabriel's or the slice
needs clarification) and `❌` a failure. The exit code says which one; see
[Exit codes](#exit-codes).

### After a run

- **Exit 0 — shipped.** The PR is merged, the merge commit carries its `v*`
  tag, main's own CI accepted it, and the deploys the configuration allowed
  are live and smoke-verified. The APK, if one was built, is kept at
  `~/.agents-army/fit_/workflow/releases/<tag>/app-release.apk`. The run
  cleans up after itself: every worktree it created is gone, and the
  branches it pushed are deleted on origin too, so nothing is left to tidy
  by hand. The child issues are closed and the story has lost
  `in-progress`. The final comment on the story says what shipped where,
  what was withheld, and what was cleaned up.
- **Exit 32 — the deploy failed.** The merge has landed; block 5 never
  rolls anything back. What is live is whatever the last successful
  activation left, and if QA came up before production failed, the comment
  says so. The story is labelled `needs-gabriel` and assigned, not
  `blocked`: there is nothing for a fresh run to retry. The run's record
  under `~/.agents-army/fit_/workflow/runs/story-<n>.json` names each
  deploy, the target it was moving and the reason it failed.
- **Exit 11 with an open PR — the change is the driver's own.** Every
  slice was implemented, validated and reviewed, the PR is open and its CI
  is green, and the merge is the one thing the run will not do: a pull
  request whose diff touches `workflow/` is handed to Gabriel. The story is
  labelled `needs-gabriel` and assigned, not `blocked`, the comment names
  the driver files, and every worktree and branch stays in place. Merge the
  PR yourself; the story closes with it (`Closes #N`), and the run's
  worktrees are then cleaned up with `go.py <n> --reset`.
- **Stopped or failed anywhere else.** Read the comment the run left on the
  story. It says why, and on a failure it lists everything the run created
  and whether each slice worktree is clean or dirty. Failed agent work is
  preserved in place for audit, and so are its worktree and its branch on
  origin. Blocks 2-3 failures keep `in-progress` and add `blocked`. Then
  choose:

  ```sh
  uv run go.py <n> --resume   # the stop was the driver's or a passing blip: continue
  uv run go.py <n> --reset    # the plan or the tests were wrong: undo, then run afresh
  ```

  `--resume` takes the story back (`blocked` comes off), re-derives the
  last turn's verdict from the reply and worktree it left when the turn
  ended, relaunches a turn that never replied, and refuses honestly when it
  cannot continue: bytes changed under it (exit 30), a turn is still running
  on this machine (exit 29), or a human hold (`needs-gabriel`, `paused`) is
  on the story (exit 20). It never replays a turn that ended and never
  resets an attempt counter. `--reset` is the destructive one: it narrates
  each worktree's state before removing it, archives the record beside the
  logs, and leaves a merged PR and any human hold alone.

## How to run the tests

```sh
cd workflow
uv sync
uv run pytest             # every flow scenario, about ten seconds
uv run pytest -v          # one line per scenario; the names read as sentences
uv run pytest -k gabriel  # only the scenarios whose name matches
```

The tests touch nothing real. Each one builds a small world (a real git repo
with an `origin`, in a temporary folder) and puts fake `gh`, `aarmy` and `bun`
from `tests/fakes/` first on `PATH`. The fake agents answer from a script.
Then the test runs `go.py` as a subprocess and checks the exit code, the log,
and what ended up on the fake issues. No network, no agent turns, no GitHub
writes.

Most tests are end-to-end flow scenarios covering happy paths, stops and
failures. Focused acceptance helper tests also cover report parsing and
rejection of local stand-ins for product behavior.

### Read the log a test produced

Keep the temporary folders, then open the log:

```sh
uv run pytest -k split_story --basetemp=/tmp/fitflow-tests
find /tmp/fitflow-tests -name '*.log'
```

### Add a scenario

Copy the nearest test in `tests/test_pick_and_plan.py`. Describe the world
(`world.given_story`, `world.planner_answers_whose_call`,
`world.planner_answers_slices`, `world.mechanic_writes`, …), run the flow, and
assert the exit code, the log lines, and the state of the issues.

### Lint

```sh
uv run ruff check .
uv run ruff format --check .  # `uv run ruff format .` fixes formatting
```

Fit_'s own checks also read the Markdown in this folder. Run them from the
repository root: `bun run lint:docs` and `bun run spellcheck`.

## Reference

### Where things are

| path                      | what                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `go.py`                   | the flow, box by box                                        |
| `delegation-contract.md`  | the block 2/3 gates, the delivery gates and the ship gates  |
| `agents.yaml`             | all four roles' backend, model and effort                   |
| `fitflow/agent_config.py` | strict, source-relative YAML loading and validation         |
| `fitflow/selection.py`    | the nine signals and the role precedence table              |
| `fitflow/assignment.py`   | the assignment envelope's strict validation                 |
| `fitflow/runstate.py`     | the story lock and the persisted per-slice state machines   |
| `fitflow/steps/`          | one module per box of the diagram                           |
| `fitflow/steps/resume.py` | `--resume`: reconcile the record with the worktrees it left |
| `fitflow/steps/reset.py`  | `--reset`: undo what a run created, archive its record      |
| `fitflow/github.py`       | the only code that runs `gh`                                |
| `fitflow/agents.py`       | the only code that runs `aarmy`                             |
| `fitflow/worktrees.py`    | the only code that runs `git` and `bun run worktree:new`    |
| `fitflow/acceptance.py`   | runs acceptance tests and reads their report (failing/pass) |
| `fitflow/prompts/`        | what each agent is told                                     |
| `fitflow/schemas/`        | the shape each agent must answer in                         |
| `fitflow/settings.py`     | repository, label, timeout and path settings                |

### Seeded agent configuration

The validated entries in `agents.yaml` are passed explicitly as flags on every
`aarmy talk` call.

| role     | backend | model | effort |
| -------- | ------- | ----- | ------ |
| planner  | claude  | opus  | low    |
| mechanic | claude  | haiku | medium |
| builder  | claude  | opus  | low    |
| solver   | claude  | opus  | high   |
| reviewer | claude  | opus  | medium |

### Settings

Every variable the driver reads. All are optional except block 5's deploy
targets, which are required only under the `FIT_FLOW_SHIP_TO` value that
uses them (next table).

| variable                           | default                             | what                                                                                                                         |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `FIT_REPO`                         | the git top level above this folder | the repository the worktrees are created under                                                                               |
| `FIT_GITHUB_REPO`                  | `Gabes-Tint/Fit_`                   | the `-R` every `gh` call carries                                                                                             |
| `FIT_FLOW_AGENT_CONFIG`            | `agents.yaml` beside `go.py`        | the roster: backend, model and effort per role                                                                               |
| `FIT_FLOW_HOME`                    | `~/.agents-army/fit_/workflow`      | `teams/` (AI Army teams), `logs/issue-<n>/`, `runs/story-<n>.json` (and `.reset.json` archives), `locks/`, `releases/<tag>/` |
| `FIT_FLOW_TALK_TIMEOUT`            | `1800`                              | seconds per agent turn (`aarmy talk --timeout`)                                                                              |
| `FIT_FLOW_CI_TIMEOUT`              | `1800`                              | seconds waiting on a PR's checks and on the merge to land (block 4)                                                          |
| `FIT_FLOW_CI_POLL_SECONDS`         | `30`                                | seconds between `gh pr checks` and `gh pr view` polls                                                                        |
| `FIT_FLOW_TRANSIENT_RETRY_SECONDS` | `15`                                | seconds before the one retry of a `gh` call or an `aarmy talk` that failed transiently                                       |
| `FIT_FLOW_MAIN_CI_TIMEOUT`         | `3600`                              | seconds waiting for the merge commit's tag and for main's own CI run (block 5)                                               |

### Ship settings (block 5)

The deploy targets are never in this repository: they name machines Gabriel
owns, so they arrive in the environment and the run refuses to start
without the ones it will need. All of these are read and validated at
startup, before any side effect - a missing one is `configuration error:
…`, exit 2.

| variable                      | default                                   | what                                                                                           |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `FIT_FLOW_SHIP_TO`            | `none`                                    | `none` never deploys; `qa` stops after the QA deploy; `prod` also ships production and Android |
| `FIT_FLOW_QA_DEPLOY_HOST`     | required when `FIT_FLOW_SHIP_TO=qa\|prod` | `user@host` for the QA deploy (`FIT_DEPLOY_HOST`)                                              |
| `FIT_FLOW_QA_PUBLIC_ORIGIN`   | required when `FIT_FLOW_SHIP_TO=qa\|prod` | the `https://` origin QA answers under (`FIT_PUBLIC_ORIGIN`)                                   |
| `FIT_FLOW_PROD_DEPLOY_HOST`   | required when `FIT_FLOW_SHIP_TO=prod`     | `user@host` for production                                                                     |
| `FIT_FLOW_PROD_PUBLIC_ORIGIN` | required when `FIT_FLOW_SHIP_TO=prod`     | production's `https://` origin                                                                 |
| `FIT_FLOW_ANDROID`            | `yes`                                     | build the APK after a successful production deploy (`no` skips it)                             |

### Exit codes

Defined in `fitflow/outcome.py`. Every stop and failure is also a comment on
the story; blocks 2-3 terminal failures additionally label the story
`blocked`.

| code | name                 | meaning                                                                                                                                                                                                               |
| ---- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | PLANNED              | the whole flow ran (aliases IMPLEMENTED, DELIVERED, SHIPPED); also `--reset` done (RESET)                                                                                                                             |
| 2    | (usage)              | bad arguments, a bad `agents.yaml`, or a missing deploy target for `FIT_FLOW_SHIP_TO`                                                                                                                                 |
| 10   | NOTHING_TO_PICK      | no open story is free to pick                                                                                                                                                                                         |
| 11   | NEEDS_GABRIEL        | the call is Gabriel's, or a slice needs clarification: labelled, assigned, question posted; also a PR that changes the driver, left open for his merge                                                                |
| 20   | CANNOT_PICK          | the named issue does not exist, is closed, is not a story, or is held; with `--resume`, also no retained run, a human hold, or a run already shipped                                                                  |
| 21   | AGENT_FAILED         | an agent turn failed or never gave a reply that fits its schema                                                                                                                                                       |
| 22   | AGENT_BROKE_CONTRACT | slices break the rules, an agent weakened an acceptance test or committed, an identity mismatch, or an out-of-reach path left there through the whole correction budget                                               |
| 23   | TESTS_NOT_PUSHED     | the mechanic's work is not committed, pushed, or tests only                                                                                                                                                           |
| 24   | TESTS_DO_NOT_FAIL    | a test file passed, only skipped its tests, or never ran                                                                                                                                                              |
| 25   | WORKTREE_EXISTS      | the slice's worktree or branch already exists                                                                                                                                                                         |
| 26   | TOOL_FAILED          | `gh`, `git` or `bun` failed unexpectedly, or a reply could not be parsed                                                                                                                                              |
| 27   | PLAN_REJECTED        | the delegation contract was rejected (bad signals, no evidence, dependent slices); replan                                                                                                                             |
| 28   | CAPACITY_EXHAUSTED   | a slice's solver exhausted its 3 attempts, review did not converge, or CI stayed red after 2 CI fix rounds (or after the one rerun, when its log named nothing the driver could act on); everything preserved         |
| 29   | EXECUTION_HELD       | another `go.py` run already owns this story's lock; with `--resume`, a turn is still running here                                                                                                                     |
| 30   | RUN_STATE_CONFLICT   | an earlier run left its retained state behind: `--resume` continues it, `--reset` archives it; with `--resume`, the record and the worktrees disagree (bytes changed, a review fix was interrupted, the PR is closed) |
| 31   | TESTS_INVALID        | the acceptance tests fail their own gate: lint, types, a suppression, a test that throws, a test in the wrong folder, or a red CI that blames nothing but a retained test                                             |
| 32   | DEPLOY_FAILED        | a deploy or its smoke check failed after the merge: labelled `needs-gabriel`, never rolled back                                                                                                                       |
