"""Argument parsing, narration setup, and turning the run's outcome (a
FlowFailure, an unexpected tool error, or a clean Outcome) into a log line, a
comment on the story when there is one to comment on, and the process exit
code. The planner's worktree is always removed here, in a finally, no
matter how the run ended.
"""

import argparse
import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from fitflow import agent_config, agents, audit, github, narrate, planner
from fitflow.outcome import FlowFailure, Outcome


def run(flow: Callable[[int | None], Outcome]) -> None:
    config_path = Path(os.environ.get("FIT_FLOW_AGENT_CONFIG", agent_config.DEFAULT_PATH))
    try:
        agents.configure(agent_config.load(config_path))
    except agent_config.AgentConfigError as error:
        print(f"configuration error: {error}", file=sys.stderr)
        raise SystemExit(2) from error
    parser = argparse.ArgumentParser(description="Fit_ development flow, block 1: pick and plan.")
    parser.add_argument("issue", nargs="?", type=int, default=None, help="issue number to pick")
    args = parser.parse_args()

    narrate.begin()
    if args.issue is not None:
        narrate.open_for_issue(args.issue)
    try:
        outcome = flow(args.issue)
    except FlowFailure as failure:
        _report_failure(failure)
        outcome = failure.outcome
    except Exception as error:
        outcome = _report_tool_failure(error)
    finally:
        planner.cleanup()
        narrate.close()
    sys.exit(int(outcome))


def _report_failure(failure: FlowFailure) -> None:
    narrate.die(f"❌ {failure.outcome.name} (exit {int(failure.outcome)}) — {failure.why}")
    if failure.story_number is not None:
        _comment_stopped(failure.story_number, f"{failure.outcome.name} — {failure.why}")


def _report_tool_failure(error: Exception) -> Outcome:
    detail = _describe(error)
    narrate.die(f"❌ TOOL_FAILED (exit {int(Outcome.TOOL_FAILED)}) — {detail}")
    number = audit.story_number()
    if number is not None:
        _comment_stopped(number, f"TOOL_FAILED — {detail}")
    return Outcome.TOOL_FAILED


def _comment_stopped(story_number: int, why: str) -> None:
    reset = audit.reset_instructions()
    body = f"Stopped: {why}"
    if reset:
        body += f"\n\nThis run created:\n{reset}"
    narrate.comment_posted(story_number, body)
    github.comment(story_number, body)


def _describe(error: Exception) -> str:
    """The failing command and its stderr tail, when the exception carries
    one (a real subprocess.CalledProcessError, e.g. from `git fetch`);
    otherwise the exception itself, which for our own RuntimeErrors already
    names the command and the stderr it saw."""
    if isinstance(error, subprocess.CalledProcessError):
        command = " ".join(error.cmd) if isinstance(error.cmd, list) else str(error.cmd)
        stderr = (error.stderr or "").strip()
        return f"{command}: {stderr[-500:] if stderr else '(no stderr)'}"
    return f"{type(error).__name__}: {error}"
