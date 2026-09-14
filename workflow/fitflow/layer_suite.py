"""The workflow layer's own pytest suite, as the driver's gates run it.

CI's "Workflow driver" job runs `uv run pytest -q` over this project after
ruff, so a driver change that breaks the driver's own tests fails the merge.
Until #462 the driver's gates did not run it at all: `ruff check` and
`ruff format` were the whole of a workflow slice's verdict, so run #462 froze,
pushed and "fixed" a branch whose suite was two tests red - every verify
passed, and only a human reading the pull request found it.

The suite runs in block 3 only. Block 1's branch is the acceptance tests
alone, failing on purpose; running the whole suite over it would reject every
branch block 1 exists to accept, so the acceptance run stays the only test run
there.
"""

import os
import re

#: The step's name in the narration and in a rejection's headline.
LABEL = "pytest"

#: CI runs `uv run pytest -q` with `workflow/` as its working directory. The
#: driver runs every gate from the worktree root, so it names the directory
#: and pins the rootdir there too: pytest prints node ids relative to the
#: rootdir, and a culprit the driver can blame has to be the
#: repository-relative path the rest of the run speaks
#: (`workflow/tests/test_x.py`, never `tests/test_x.py`).
#:
#: The rootdir is also where pytest writes its cache, and at the repository
#: root that is an untracked directory carrying a README the repository's own
#: `format:check` rejects - a gate that dirties the tree it judges. The one
#: `workflow/` already ignores is named instead.
#: `-n auto` runs the suite across one pytest-xdist worker per core: serial it
#: takes about twelve minutes on a developer machine, parallel about a minute
#: and a half, and a gate that slow on every block 3 turn and every block 4 fix
#: turn is one nobody keeps. Distribution changes neither line the diagnostic
#: reads: `-q` prints no `[gw0]` prefixes, so the `FAILED <file>::<test>` lines
#: and the final count keep the shape the patterns below expect.
ARGV = [
    "uv",
    "run",
    "--project",
    "workflow",
    "pytest",
    "-q",
    "-n",
    "auto",
    "-o",
    "cache_dir=workflow/.pytest_cache",
    "--rootdir",
    ".",
    "workflow/tests",
]

#: pytest's short summary, which `-q` still prints: one line per failing test
#: and one per module it could not import, each starting with the file. They
#: are the last thing it prints, so the diagnostic reads from the tail.
_FAILED = re.compile(r"^FAILED ([\w./@+-]+\.py)::")
_ERRORED = re.compile(r"^ERROR ([\w./@+-]+\.py)")
PATTERNS = (_FAILED, _ERRORED)

#: pytest truncates its summary lines to the terminal width, and a captured
#: pipe is 80 columns - the same reason `acceptance` asks for 200.
_COLUMNS = "200"


def env() -> dict[str, str]:
    """The environment the suite runs in: the driver's own, minus every
    `FIT_FLOW_*` variable.

    The suite spawns `go.py` runs of its own, and `tests/conftest.py` builds
    their environment from `os.environ`. The settings it does not overwrite
    would otherwise be whatever the driver run that launched this gate was
    configured with - `FIT_FLOW_CI_POLL_SECONDS` and
    `FIT_FLOW_TRANSIENT_RETRY_SECONDS` are `setdefault`s, and the deploy
    variables are left alone unless a test asks for one. A gate judges the
    branch, not the machine its run happens to be configured for.
    """
    inherited = {
        name: value for name, value in os.environ.items() if not name.startswith("FIT_FLOW_")
    }
    return inherited | {"COLUMNS": _COLUMNS}
