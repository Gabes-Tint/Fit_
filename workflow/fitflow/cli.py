"""Argument parsing, narration setup, and turning the run's outcome (or a
FlowFailure) into a log line, a comment on the story when there is one to
comment on, and the process exit code. The planner's worktree is always
removed here, in a finally, no matter how the run ended.
"""

import argparse
import sys
from collections.abc import Callable

from fitflow import github, narrate, planner, settings
from fitflow.outcome import FlowFailure, Outcome


def run(flow: Callable[[int | None, bool], Outcome]) -> None:
    parser = argparse.ArgumentParser(description="Fit_ development flow, block 1: pick and plan.")
    parser.add_argument("issue", nargs="?", type=int, default=None, help="issue number to pick")
    parser.add_argument(
        "--spend-flagged", action="store_true", help="treat spending as flagged for this story"
    )
    args = parser.parse_args()

    narrate.start(args.issue if args.issue is not None else "auto")
    spend_flagged = args.spend_flagged or settings.SPEND_FLAGGED
    try:
        outcome = flow(args.issue, spend_flagged)
    except FlowFailure as failure:
        _report_failure(failure)
        outcome = failure.outcome
    finally:
        planner.cleanup()
        narrate.close()
    sys.exit(int(outcome))


def _report_failure(failure: FlowFailure) -> None:
    narrate.die(f"❌ {failure.outcome.name} (exit {int(failure.outcome)}) — {failure.why}")
    if failure.story_number is not None:
        github.comment(failure.story_number, f"Stopped: {failure.outcome.name} — {failure.why}")
