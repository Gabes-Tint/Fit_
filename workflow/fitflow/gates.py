"""The turn gates: `bun run verify:changed` and, for block 1's
acceptance-test branch, `bun run lint:changed` - the repository's own
diff-sized gates.

`run_turn_gates` runs one command in the slice worktree that sizes and runs
everything the turn's actual diff needs — the static checks, the specs that
import or sit beside the changed files, the route e2e files, every applicable
mutation lane and the bundle/build triggers — using the repository's
dependency and route mapping from `scripts/quality/verify-changed-plan.ts`.
The driver adds no derivation of its own, so its view can never drift from
the repo's.

`run_changed_lint` covers block 1: acceptance tests become immutable
implementation inputs, so they must pass their own change-scoped lint before
the branch is accepted, and the mechanic gets the diagnostic.

Verdicts come from the gate's own report
(`reports/quality/gate-verify-changed.json`), never from a missing one:
exit 0 with a fresh `ok` report passes; exit 1 with named failed steps is a
repairable diagnostic; a crash (exit 97), a missing, stale or unparsable
report, or a report contradicting the exit code is an external tool
failure that stops the run — never an implementation verdict, never a
success. No full local CI tier is implied.
"""

import json
import subprocess
import time
from pathlib import Path

from fitflow.outcome import FlowFailure, Outcome

_CRASH_EXIT_CODE = 97
_REPORT = Path("reports") / "quality" / "gate-verify-changed.json"


def run_changed_lint(worktree: Path, story_number: int) -> str | None:
    """Run the repository's change-scoped lint in the slice worktree and
    return a repairable diagnostic, or None when it passes. Block 1 runs it
    over the failing-test branch: acceptance tests become immutable inputs,
    so tests whose own lint is broken are never accepted. Exit 1 with lint
    output is a repairable diagnostic; any other exit is an external tool
    failure, never a lint verdict."""
    try:
        result = subprocess.run(
            ["bun", "run", "lint:changed"],
            cwd=worktree,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise FlowFailure(
            Outcome.TOOL_FAILED, f"lint:changed could not run: {error}", story_number
        ) from error
    # both streams can carry real diagnostics: eslint prints the error body
    # to stdout in some configurations and to stderr in others, so neither
    # stream alone may be the verdict (#382)
    output = "\n".join(
        stream.strip() for stream in (result.stderr, result.stdout) if stream.strip()
    )
    if result.returncode == 0:
        narrate_gates(0, "lint:changed")
        return None
    if result.returncode == 1:
        return f"lint:changed failed on the acceptance tests: {output[-800:]}"
    raise FlowFailure(
        Outcome.TOOL_FAILED,
        f"lint:changed crashed (exit {result.returncode}): {output[-800:]}",
        story_number,
        add_blocked=True,
    )


def run_turn_gates(worktree: Path, story_number: int) -> str | None:
    """Run the pre-push gate for this turn's diff. Returns a repairable
    diagnostic, or None when the gate passed."""
    started = time.time()
    try:
        result = subprocess.run(
            ["bun", "run", "verify:changed"],
            cwd=worktree,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise FlowFailure(
            Outcome.TOOL_FAILED, f"verify:changed could not run: {error}", story_number
        ) from error
    report_path = worktree / _REPORT
    report = _fresh_report(report_path, started, story_number)
    failed = report.get("failed") or []
    crashed = report.get("crashed") or []
    if result.returncode == 0:
        if report.get("ok") is not True or failed or crashed:
            raise FlowFailure(
                Outcome.TOOL_FAILED,
                f"verify:changed report contradicts its green exit: {report_path}",
                story_number,
                add_blocked=True,
            )
        narrate_gates(int(report.get("stepsRun", 0) or 0))
        return None
    if result.returncode == 1 and failed and not crashed:
        return f"verify:changed failed steps: {', '.join(failed)}"
    raise FlowFailure(
        Outcome.TOOL_FAILED,
        f"verify:changed crashed (exit {result.returncode}); "
        f"failed={failed}, crashed={crashed} — see {report_path}",
        story_number,
        add_blocked=True,
    )


def _fresh_report(report_path: Path, started: float, story_number: int) -> dict:
    """The gate report must exist, be written by this turn, and parse. A
    missing, stale or unparsable report is never treated as a failed
    assertion and never as success."""
    if not report_path.exists():
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"verify:changed left no gate report at {report_path}",
            story_number,
            add_blocked=True,
        )
    if report_path.stat().st_mtime < started:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"verify:changed gate report is stale (predates this turn): {report_path}",
            story_number,
            add_blocked=True,
        )
    try:
        report = json.loads(report_path.read_text())
    except (ValueError, OSError) as error:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"verify:changed gate report is unparsable: {error}",
            story_number,
            add_blocked=True,
        ) from error
    if (
        not isinstance(report, dict)
        or not isinstance(report.get("failed"), list)
        or not isinstance(report.get("crashed"), list)
    ):
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"verify:changed gate report has an unexpected shape: {report_path}",
            story_number,
            add_blocked=True,
        )
    return report


def narrate_gates(steps_run: int, tool: str = "verify:changed") -> None:
    from fitflow import narrate

    if tool == "verify:changed":
        narrate.line(f"🧪 Gates: verify:changed ✔ ({steps_run} steps)")
        return
    narrate.line(f"🧪 Gates: {tool} ✔")
