# workflow

The user starts `go.py` manually. It is intended to become the autonomous,
maximally deterministic driver for Fit_'s complete
[development flow](../docs/development-flow.md): issue selection, planning,
implementation, gates, review, CI, merge, deploy and reporting. No external
Codex or Claude Code session is required to supervise or continuously monitor it. Agents
invoked through `aarmy` are bounded workers under the Python driver's control;
their replies must match JSON schemas.

The [delegation and implementation gates](delegation-contract.md) are
implemented for blocks 1-3: role selection, pre-launch validation, bounded
repairs, escalation and the final all-slice barrier. Delivery (implementation
push, PR, review, CI, merge, deploy) begins in block 4 and is not implemented. An
optional external operator may start and observe a run, but cannot mutate the
workflow or worktrees while it runs. Coordinated cancellation is not
implemented: an external interruption leaves retained state for audit, and a
new invocation refuses to replay it automatically.

Blocks 1-3 run in one `go.py` invocation. Block 1 runs every command and
check itself, calling agents only at the judgment boxes ("whose call?",
"spans domain and UI?") and to write the failing tests. Block 2 asks the
planner to extract each slice's nine capability signals with evidence, then
the driver itself decides the rung (mechanic, builder or solver) from the
precedence table. Block 3 runs one bounded implementation loop per slice in
parallel; after every turn the driver independently validates scope, branch
identity and acceptance behavior and then runs the repository's own
diff-sized pre-push gate (`bun run verify:changed`) in the slice worktree,
whose plan derives the affected specs, e2e files and mutation lanes from the
actual diff under the repo's dependency and route mapping. A judged failing
step (exit 1) retries in the same role; a crash, missing, stale or
inconsistent gate report stops at once. The driver commits, freezes and
joins at the final barrier; agents never commit or push. Every agent turn
carries the session id the AI Army CLI printed, and the driver persists it
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
mechanic until the diagnostic is clean), and acceptance tests carry no lint
suppression at all (`eslint-disable`, `@ts-ignore`, `@ts-expect-error` are
rejected). A playwright spec must exercise a component through the
repository-owned harness route `/dev/component-harness` (see
`src/routes/dev/component-harness/+page.svelte`); importing product code
inside `page.evaluate` is rejected the same way a self-invented route
fixture is - production files stay off-limits to the mechanic. The harness
is a test-only surface: the web server 404s `/dev/` without the
`FIT_COMPONENT_HARNESS=yes` runtime flag and the Capacitor build refuses it
outright, so it never mounts a component in the shipped app.

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
  model: haiku
  effort: low
mechanic:
  backend: claude
  model: haiku
  effort: low
builder:
  backend: claude
  model: sonnet
  effort: medium
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
```

From the repository root: `uv run --project workflow workflow/go.py 351`.

"Held" means labelled `in-progress`, `blocked`, `needs-gabriel` or `paused`.
Exit 0 means every slice is implemented and validated through the final
barrier; delivery (block 4) has not run and the story keeps `in-progress`.

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
🔍 Verify #1000: scope ✔ · acceptance pass ✔ · branch identity ✔ · no gate or workflow files ✔
🔒 #1000 (domain) frozen at 485e7af…
⏳ Implementation barrier: all 2 slices settled
🏁 Implemented #140 → #1000 domain (mechanic, 485e7af…) · next: block 4, review
```

`🛑` marks a planned stop (for example, the call is Gabriel's or the slice
needs clarification) and `❌` a failure. The exit code says which one; see
[Exit codes](#exit-codes).

### After a run

- **Exit 0:** every slice has a worktree at `.claude/worktrees/story-<n>-<layer>`,
  a pushed branch carrying the failing tests, and a local implementation
  commit the driver made and froze. Nothing has been pushed beyond block 1's
  failing-test branch, no PR exists, and the story keeps `in-progress`:
  delivery (block 4) comes next.
- **Stopped or failed:** read the comment the run left on the story. It says
  why, and on a failure it lists everything the run created, whether each
  slice worktree is clean or dirty, and how to undo it. Failed agent work is
  preserved in place for audit; the story keeps `in-progress` and gains
  `blocked`; inspect it before using the destructive `--force` cleanup
  command:

  ```sh
  gh issue edit <n> -R Gabes-Tint/Fit_ --remove-label in-progress
  bun run worktree:done story-<n>-<layer> --force
  git push origin --delete story-<n>-<layer>
  ```

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
| `delegation-contract.md`  | the block 2/3 gates and transitions                         |
| `agents.yaml`             | all four roles' backend, model and effort                   |
| `fitflow/agent_config.py` | strict, source-relative YAML loading and validation         |
| `fitflow/selection.py`    | the nine signals and the role precedence table              |
| `fitflow/assignment.py`   | the assignment envelope's strict validation                 |
| `fitflow/runstate.py`     | the story lock and the persisted per-slice state machines   |
| `fitflow/steps/`          | one module per box of the diagram                           |
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

| role     | backend | model  | effort |
| -------- | ------- | ------ | ------ |
| planner  | claude  | haiku  | low    |
| mechanic | claude  | haiku  | low    |
| builder  | claude  | sonnet | medium |
| solver   | claude  | opus   | high   |

### Settings

| variable                | default                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `FIT_REPO`              | the git top level above this folder                         |
| `FIT_GITHUB_REPO`       | `Gabes-Tint/Fit_`                                           |
| `FIT_FLOW_HOME`         | `~/.agents-army/fit_/workflow` (`teams/`, `logs/`, `runs/`) |
| `FIT_FLOW_TALK_TIMEOUT` | `1800` seconds per agent turn                               |

### Exit codes

Defined in `fitflow/outcome.py`. Every stop and failure is also a comment on
the story; blocks 2-3 terminal failures additionally label the story
`blocked`.

| code | name                 | meaning                                                                                    |
| ---- | -------------------- | ------------------------------------------------------------------------------------------ |
| 0    | PLANNED              | planned, delegated, implemented - every slice passed its gates (alias IMPLEMENTED)         |
| 2    | (usage)              | bad arguments                                                                              |
| 10   | NOTHING_TO_PICK      | no open story is free to pick                                                              |
| 11   | NEEDS_GABRIEL        | the call is Gabriel's, or a slice needs clarification: labelled, assigned, question posted |
| 20   | CANNOT_PICK          | the named issue does not exist, is closed, is not a story, or is held                      |
| 21   | AGENT_FAILED         | an agent turn failed or never gave a reply that fits its schema                            |
| 22   | AGENT_BROKE_CONTRACT | slices break the rules, an agent escaped its scope, or an identity mismatch                |
| 23   | TESTS_NOT_PUSHED     | the mechanic's work is not committed, pushed, or tests only                                |
| 24   | TESTS_DO_NOT_FAIL    | a test file passed, or never ran                                                           |
| 25   | WORKTREE_EXISTS      | the slice's worktree or branch already exists                                              |
| 26   | TOOL_FAILED          | `gh`, `git` or `bun` failed unexpectedly, or a reply could not be parsed                   |
| 27   | PLAN_REJECTED        | the delegation contract was rejected (bad signals, no evidence, dependent slices); replan  |
| 28   | CAPACITY_EXHAUSTED   | a slice's solver exhausted its 3 attempts; everything preserved                            |
| 29   | EXECUTION_HELD       | another `go.py` run already owns this story's lock                                         |
| 30   | RUN_STATE_CONFLICT   | an earlier run left its retained state behind; audit it, then remove the file manually     |
| 31   | TESTS_INVALID        | the acceptance tests fail their own gate: lint, a suppression, or a browser-context import |
