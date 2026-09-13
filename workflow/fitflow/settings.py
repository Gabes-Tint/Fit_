"""Repository paths, label names, timeouts, and environment knobs."""

import os
import subprocess
from dataclasses import dataclass
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

# How long to sleep before the one retry of a `gh` call or an `aarmy talk`
# that failed with a transient external signature (a GitHub 5xx, a network
# blip, an empty-message backend error) - see fitflow/github.py's
# TRANSIENT_SIGNATURES.
TRANSIENT_RETRY_SECONDS = float(os.environ.get("FIT_FLOW_TRANSIENT_RETRY_SECONDS", "15"))

# Block 4: how long `gh pr checks` may stay pending before the run stops as
# a tool failure, and how long to sleep between polls. The required check is
# the ci.yml `all-green` job; `gh pr checks` reports it under the job's
# display name, and the check run only appears once its needs finish.
CI_TIMEOUT = float(os.environ.get("FIT_FLOW_CI_TIMEOUT", "1800"))
CI_POLL_SECONDS = float(os.environ.get("FIT_FLOW_CI_POLL_SECONDS", "30"))
REQUIRED_CHECK = "Quality and security"

# Block 5: how long to wait for the merge's tag and for main's own CI run.
# Longer than the PR-check timeout on purpose - a full main run includes the
# e2e matrix and the mutation lanes, and it queues behind every other merge.
MAIN_CI_TIMEOUT = float(os.environ.get("FIT_FLOW_MAIN_CI_TIMEOUT", "3600"))

# --- Block 5's deploy targets ------------------------------------------------


class ConfigurationError(ValueError):
    """A required environment variable is missing or malformed."""


@dataclass(frozen=True)
class Target:
    host: str
    origin: str


@dataclass(frozen=True)
class ShipConfig:
    """Where this run may deploy, and how far.

    The hosts are not here and are nowhere in this repository, for the
    reason `scripts/deploy/config.ts` gives: they are infrastructure
    Gabriel owns. They arrive in the environment, and a run that cannot
    name its target refuses to start rather than merging a pull request it
    then cannot ship. FIT_FLOW_SHIP_TO=none, the default, ships nothing:
    the driver never deploys unless told to."""

    ship_to: str  # "none", "qa" or "prod"
    qa: Target | None  # None when FIT_FLOW_SHIP_TO=none
    prod: Target | None  # None unless FIT_FLOW_SHIP_TO=prod
    android: bool

    @property
    def to_qa(self) -> bool:
        return self.ship_to in ("qa", "prod")

    @property
    def to_prod(self) -> bool:
        return self.ship_to == "prod"


def _required(variable: str) -> str:
    value = os.environ.get(variable, "").strip()
    if not value:
        raise ConfigurationError(
            f"{variable} must name block 5's deployment target, for example "
            f"{variable}=user@host; there is no default"
        )
    return value


def _choice(variable: str, default: str, allowed: set[str]) -> str:
    value = os.environ.get(variable, default).strip() or default
    if value not in allowed:
        raise ConfigurationError(
            f"{variable} must be one of {', '.join(sorted(allowed))}; got {value!r}"
        )
    return value


def ship_config() -> ShipConfig:
    """Read and validate block 5's configuration. Called at startup, before
    any side effect, so a missing host stops the run instead of the deploy."""
    ship_to = _choice("FIT_FLOW_SHIP_TO", "none", {"none", "qa", "prod"})
    qa = None
    prod = None
    if ship_to in ("qa", "prod"):
        qa = Target(_required("FIT_FLOW_QA_DEPLOY_HOST"), _required("FIT_FLOW_QA_PUBLIC_ORIGIN"))
    if ship_to == "prod":
        prod = Target(
            _required("FIT_FLOW_PROD_DEPLOY_HOST"), _required("FIT_FLOW_PROD_PUBLIC_ORIGIN")
        )
    return ShipConfig(ship_to, qa, prod, _choice("FIT_FLOW_ANDROID", "yes", {"yes", "no"}) == "yes")


# The variables `scripts/deploy/config.ts` reads. The driver passes the
# target through these and nothing else.
DEPLOY_HOST_VARIABLE = "FIT_DEPLOY_HOST"
PUBLIC_ORIGIN_VARIABLE = "FIT_PUBLIC_ORIGIN"

# --- Labels that hold a story off the pick list ------------------------------

HOLDING_LABELS = {"in-progress", "blocked", "needs-gabriel", "paused"}
STORY_LABEL = "story"
IN_PROGRESS_LABEL = "in-progress"
BLOCKED_LABEL = "blocked"
NEEDS_GABRIEL_LABEL = "needs-gabriel"
GABRIEL_LOGIN = "gabepsilva"
