# workflow

`go.py` drives block 1 ("Pick and plan") of Fit_'s development flow —
[docs/development-flow.md](../docs/development-flow.md) — deterministically,
in the style of agents-army's `gdw-v5` driver. The script owns every command
and every check; agents are called only at the two judgment boxes ("whose
call?" and "spans domain and UI?"), each through `aarmy talk --schema` so the
answer is a validated verdict rather than prose.

Read `go.py` top to bottom: each line is a box or a diamond of the diagram.
The detail lives in `fitflow/steps/`, one module per box; `fitflow/github.py`,
`fitflow/agents.py`, and `fitflow/worktrees.py` are the only modules that
shell out to `gh`, `aarmy`, and `git`/`bun` respectively.

## Running it

```sh
cd workflow
uv run go.py                 # pick the lowest-numbered open, unheld story
uv run go.py 351              # pick a specific issue
uv run go.py --spend-flagged  # stop at "spending flagged?" instead of slicing
```

## Roster

One dict, `fitflow.settings.ROSTER`: moving an agent to another backend,
model, or reasoning effort is one line.

| role     | backend | model | effort |
| -------- | ------- | ----- | ------ |
| planner  | claude  | opus  | medium |
| mechanic | claude  | haiku | low    |

## Env knobs (`fitflow/settings.py`)

| variable                 | default                                    |
| ------------------------ | ------------------------------------------ |
| `FIT_REPO`               | the git toplevel above this directory      |
| `FIT_GITHUB_REPO`        | `Gabes-Tint/Fit_`                          |
| `FIT_FLOW_HOME`          | `~/.agents-army/fit_/workflow`             |
| `FIT_FLOW_SPEND_FLAGGED` | unset (`1` behaves like `--spend-flagged`) |

`FIT_FLOW_HOME` holds `teams/` (passed to `aarmy` as `AGENTS_ARMY_TEAMS_DIR`)
and `logs/`.

## Exit codes (`fitflow/outcome.py`)

| code | name                 | meaning                                                  |
| ---- | -------------------- | -------------------------------------------------------- |
| 0    | PLANNED              | the story (or its slices) is ready for block 2           |
| 2    | (argparse usage)     | bad arguments                                            |
| 10   | NOTHING_TO_PICK      | no open, unheld story to pick                            |
| 11   | NEEDS_GABRIEL        | the call is Gabriel's; handed off, labelled, assigned    |
| 12   | PAUSED               | spending is flagged; filed only                          |
| 20   | NOT_PICKABLE         | the named issue is closed, not a story, or held          |
| 21   | AGENT_FAILED         | an `aarmy` turn exited non-zero                          |
| 22   | AGENT_BROKE_CONTRACT | the planner's slice reply broke the driver's contract    |
| 23   | TESTS_NOT_PUSHED     | the mechanic's tests are not clean, pushed, or test-only |
| 24   | TESTS_DO_NOT_FAIL    | the acceptance tests passed with no implementation       |
| 25   | WORKTREE_EXISTS      | the slice's worktree or branch already exists            |

Every failure and stop is also a comment on the story explaining what
happened and why (block 2 has nothing to go on otherwise).

## Logs

Every run prints the same log to stdout and to
`<FIT_FLOW_HOME>/logs/issue-<n>/<timestamp>.log` (which also carries each
agent reply's raw JSON, for audit). The log narrates which issue was picked
and its labels, every decision and which side of the flow it took, every
prompt sent to an agent in full, and every reply rendered into readable
lines.

## Testing and linting

```sh
cd workflow
uv sync
uv run pytest          # end-to-end only: each test runs go.py as a subprocess
                        # against a fake gh/aarmy/bun and a real git repo
uv run ruff check .
uv run ruff format --check .
```
