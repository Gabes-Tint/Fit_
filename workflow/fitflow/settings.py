"""Repository paths, label names, timeouts, and environment knobs."""

import os
import subprocess
from pathlib import Path


def _git_toplevel() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=Path(__file__).resolve().parent,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return Path(out)


# --- Repo and GitHub -------------------------------------------------------

FIT_REPO = Path(os.environ.get("FIT_REPO", str(_git_toplevel())))
FIT_GITHUB_REPO = os.environ.get("FIT_GITHUB_REPO", "Gabes-Tint/Fit_")

# --- Home for teams and logs ------------------------------------------------

FIT_FLOW_HOME = Path(
    os.environ.get("FIT_FLOW_HOME", str(Path.home() / ".agents-army" / "fit_" / "workflow"))
)
TEAMS_DIR = FIT_FLOW_HOME / "teams"
LOGS_DIR = FIT_FLOW_HOME / "logs"

TALK_TIMEOUT = os.environ.get("FIT_FLOW_TALK_TIMEOUT", "1800")

# --- Labels that hold a story off the pick list ------------------------------

HOLDING_LABELS = {"in-progress", "blocked", "needs-gabriel", "paused"}
STORY_LABEL = "story"
IN_PROGRESS_LABEL = "in-progress"
BLOCKED_LABEL = "blocked"
NEEDS_GABRIEL_LABEL = "needs-gabriel"
GABRIEL_LOGIN = "gabepsilva"
