"""Reading a red CI job's log well enough to act on it.

Block 4 used to treat every red check as a flake: one `gh run rerun
--failed`, and a second red stopped the run. A deterministic failure -
#397's acceptance test in a folder the coverage lane counts as source -
then cost a rerun and the run, twice saying the same thing, with the answer
sitting in the job log the driver never read.

So the log is read. `diagnose` turns the failed jobs' log into the same
shape a gate failure has (`gates.GateFailure`): the error lines worth
quoting to an implementer, the repository files they name, and whether
anything was located at all. Located means the driver may act on the
culprits; unlocated means nothing may be concluded from them - an artifact
upload 403 or a lost runner names no file, and that is still the rerun's
case.
"""

import re

from fitflow.gates import GateFailure

#: A path is a culprit only inside the repository's own trees. A log is full
#: of paths in the runner's image and in node_modules, and none of those is
#: anything an implementer can change.
_REPO_TREES = ("src", "scripts", "workflow", "tests", "android", "quality")
_PATH = re.compile(r"(?<![\w./-])(?:" + "|".join(_REPO_TREES) + r")/[\w./@+-]*\w\.[A-Za-z0-9]+")

#: What makes a log line worth quoting. Deliberately broad and deliberately
#: cheap: the lines are only ever shown to a human or an agent, and the
#: culprits are taken from them, so a line too many costs nothing while a
#: line too few costs a fix round.
_ERROR_MARKERS = (
    "ERROR:",
    "Error:",
    "error:",
    "FAIL",
    "✖",
    "##[error]",
    "does not meet",
    "failed",
    "Failed",
)

#: `gh run view --log-failed` prefixes every line with the job name, the
#: step name and a timestamp, tab separated.
_TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z\s+")
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

_QUOTED_LINES = 12
_QUOTED_CHARS = 1200


def diagnose(failed: list[str], log: str) -> GateFailure:
    """The failed checks and their log, as a gate-shaped failure."""
    headline = f"CI is red: {', '.join(failed)}"
    quoted = _worth_quoting(log)
    culprits = _culprits(quoted)
    diagnostic = "\n".join([headline, *quoted]) if quoted else headline
    return GateFailure(
        diagnostic=_capped(diagnostic), culprits=frozenset(culprits), located=bool(culprits)
    )


def blamed_lines(diagnostic: str, file: str) -> str:
    """The diagnostic's own lines that name `file` - what the implementer is
    told to fix about it. Falls back to the whole diagnostic when the file
    is named nowhere, which only a caller inventing a culprit can reach."""
    named = [line for line in diagnostic.splitlines() if file in line]
    return "\n".join(named) if named else diagnostic


def _worth_quoting(log: str) -> list[str]:
    lines: list[str] = []
    for raw in log.splitlines():
        line = _clean(raw)
        if line and any(marker in line for marker in _ERROR_MARKERS) and line not in lines:
            lines.append(line)
    return lines[:_QUOTED_LINES]


def _clean(raw: str) -> str:
    """One log line, stripped of the run's own decoration: colour codes, the
    job/step columns `gh` prefixes, and the timestamp."""
    line = _ANSI.sub("", raw).rstrip()
    if "\t" in line:
        line = line.rsplit("\t", 1)[-1]
    return _TIMESTAMP.sub("", line).strip()


def _culprits(lines: list[str]) -> list[str]:
    found: list[str] = []
    for line in lines:
        for match in _PATH.findall(line):
            if match not in found:
                found.append(match)
    return found


def _capped(text: str) -> str:
    if len(text) <= _QUOTED_CHARS:
        return text
    return text[:_QUOTED_CHARS] + "…"
