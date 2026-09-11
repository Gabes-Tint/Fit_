"""One dict per agent, label names, timeouts, and the env knobs.

Move an agent to another backend/model/effort by editing one line in ROSTER.
"""

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

# FIT_FLOW_HOME is itself AGENTS_ARMY_TEAMS_DIR: aarmy resolves `--team
# issue-<n>` straight to `FIT_FLOW_HOME/issue-<n>`, one team per issue,
# reused across runs. A run's own log lives inside that team's folder
# (`issue-<n>/logs/`) once the issue is known; a run that never picks one
# (nothing to pick) never opens a log file at all.
FIT_FLOW_HOME = Path(
    os.environ.get("FIT_FLOW_HOME", str(Path.home() / ".agents-army" / "fit_" / "workflow"))
)
TEAMS_DIR = FIT_FLOW_HOME

# --- Pacing ------------------------------------------------------------------

SPEND_FLAGGED = os.environ.get("FIT_FLOW_SPEND_FLAGGED", "") == "1"

# --- Agent roster: role -> {backend, model, effort} -------------------------

ROSTER = {
    "planner": {"backend": "claude", "model": "opus", "effort": "medium"},
    "mechanic": {"backend": "claude", "model": "haiku", "effort": "low"},
}

TALK_TIMEOUT = os.environ.get("FIT_FLOW_TALK_TIMEOUT", "1800")

# --- Labels that hold a story off the pick list ------------------------------

HOLDING_LABELS = {"in-progress", "blocked", "needs-gabriel", "paused"}
STORY_LABEL = "story"
IN_PROGRESS_LABEL = "in-progress"
NEEDS_GABRIEL_LABEL = "needs-gabriel"
PAUSED_LABEL = "paused"
GABRIEL_LOGIN = "gabepsilva"
