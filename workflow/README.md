# workflow

`go.py` runs block 1, "Pick and plan", of Fit_'s
[development flow](../docs/development-flow.md). The script runs every
command and every check itself. Agents are asked only at the judgment boxes
("whose call?", "spans domain and UI?") and to write the failing tests, and
each answer must come back as JSON that matches a schema.

Read `go.py` top to bottom: each line is a box or a diamond of the diagram.

## How to run

### What you need, once

| tool         | check it with         | why                                          |
| ------------ | --------------------- | -------------------------------------------- |
| `uv`         | `uv --version`        | runs the driver and its tests                |
| `gh`         | `gh auth status`      | reads and writes issues on `Gabes-Tint/Fit_` |
| `aarmy`      | `aarmy doctor`        | talks to the agents                          |
| `claude`     | `claude --version`    | the backend behind both agents               |
| `bun`, `git` | from `.tool-versions` | `bun run worktree:new`, running test files   |

Then install the driver's environment:

```sh
cd workflow
uv sync
```

### It acts for real

A run labels and comments on real issues, may create child issues, creates
worktrees under `.claude/worktrees/`, pushes branches, and spends real agent
turns (the planner on Opus, the mechanic on Haiku). There is no dry-run mode.
To watch it work with nothing real touched, run the tests instead (below).

### Run it

```sh
cd workflow
uv run go.py 351                  # plan issue #351
uv run go.py                      # pick the lowest-numbered open story not held
uv run go.py 351 --spend-flagged  # spending is flagged: pause the story instead of slicing
```

From the repository root: `uv run --project workflow workflow/go.py 351`.

"Held" means labelled `in-progress`, `blocked`, `needs-gabriel` or `paused`.

### What you will see

The run narrates itself as it goes, and saves the same text to
`~/.agents-army/fit_/workflow/logs/issue-<n>/<timestamp>.log`:

```text
📋 Picked #140 "Sync payload"
🏷️  Labels: story
🤖➡️  planner (claude · opus · medium)
   │ # Planner: whose call?
   │ …the whole prompt…
🤖⬅️  planner replied in 41s
   │ Owner:          orchestrator
   │ Reason:         ordinary work
🔀 Whose call? → 🧑‍💻 orchestrator's
🔀 Spending flagged? → no, carry on
🔀 Spans domain and UI? → ✂️ yes, split into 2
🔍 Verify #1000: tree clean ✔ · pushed ✔ · files on branch ✔ · only tests ✔
🧪 src/lib/merge.spec.ts → failed, as it should ✔
🏁 Planned #140 → #1000 domain, #1001 ui · next: block 2, delegate
```

`🛑` marks a planned stop (for example, the call is Gabriel's) and `❌` a
failure. The exit code says which one; see [Exit codes](#exit-codes).

### After a run

- **Planned (exit 0):** each slice has a worktree at
  `.claude/worktrees/story-<n>-<layer>` and a pushed branch of the same name,
  carrying the failing tests. That is where block 2 starts.
- **Stopped or failed:** read the comment the run left on the story. It says
  why, and on a failure it lists everything the run created and how to undo
  it:

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

They are end-to-end flow tests only: the happy paths, and every stop and
failure. There are no unit tests, on purpose.

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

| path                    | what                                                     |
| ----------------------- | -------------------------------------------------------- |
| `go.py`                 | the flow, box by box                                     |
| `fitflow/steps/`        | one module per box of the diagram                        |
| `fitflow/github.py`     | the only code that runs `gh`                             |
| `fitflow/agents.py`     | the only code that runs `aarmy`                          |
| `fitflow/worktrees.py`  | the only code that runs `git` and `bun run worktree:new` |
| `fitflow/acceptance.py` | runs the mechanic's test files and reads their report    |
| `fitflow/prompts/`      | what each agent is told                                  |
| `fitflow/schemas/`      | the shape each agent must answer in                      |
| `fitflow/settings.py`   | the roster, labels and settings below                    |

### Roster

One dict, `ROSTER` in `fitflow/settings.py`. To move an agent to another
backend, model or effort, change one line.

| role     | backend | model | effort |
| -------- | ------- | ----- | ------ |
| planner  | claude  | opus  | medium |
| mechanic | claude  | haiku | low    |

### Settings

| variable                 | default                                            |
| ------------------------ | -------------------------------------------------- |
| `FIT_REPO`               | the git top level above this folder                |
| `FIT_GITHUB_REPO`        | `Gabes-Tint/Fit_`                                  |
| `FIT_FLOW_HOME`          | `~/.agents-army/fit_/workflow` (`teams/`, `logs/`) |
| `FIT_FLOW_SPEND_FLAGGED` | unset; `1` acts like `--spend-flagged`             |
| `FIT_FLOW_TALK_TIMEOUT`  | `1800` seconds per agent turn                      |

### Exit codes

Defined in `fitflow/outcome.py`. Every stop and failure is also a comment on
the story.

| code | name                 | meaning                                                                  |
| ---- | -------------------- | ------------------------------------------------------------------------ |
| 0    | PLANNED              | the story, or each of its slices, is ready for block 2                   |
| 2    | (usage)              | bad arguments                                                            |
| 10   | NOTHING_TO_PICK      | no open story is free to pick                                            |
| 11   | NEEDS_GABRIEL        | the call is Gabriel's: labelled, assigned, question posted               |
| 12   | PAUSED               | spending is flagged; the story is labelled `paused`                      |
| 20   | CANNOT_PICK          | the named issue does not exist, is closed, is not a story, or is held    |
| 21   | AGENT_FAILED         | an agent turn failed or never gave a reply that fits its schema          |
| 22   | AGENT_BROKE_CONTRACT | the planner's slices break the rules (one slice, or domain then UI)      |
| 23   | TESTS_NOT_PUSHED     | the mechanic's work is not committed, pushed, or tests only              |
| 24   | TESTS_DO_NOT_FAIL    | a test file passed, or never ran                                         |
| 25   | WORKTREE_EXISTS      | the slice's worktree or branch already exists                            |
| 26   | TOOL_FAILED          | `gh`, `git` or `bun` failed unexpectedly, or a reply could not be parsed |
