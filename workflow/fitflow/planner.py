"""Tracks the one planner worktree/team alive during a run - the "whose
call?" and "spans domain and UI?" turns share the same planner session, so
its worktree is created once, lazily, and cleaned up once, in
fitflow.cli.run()'s finally block, regardless of how the run ends.
"""

from pathlib import Path

from fitflow import agents, narrate, worktrees

_team: str | None = None
_path: Path | None = None


def ensure(issue_number: int) -> str:
    global _team, _path
    if _team is None:
        _team = f"plan-{issue_number}"
        _path = worktrees.planner_worktree(str(issue_number))
        agents.ensure_fresh_team(_team, _path, issue_number)
        narrate.line(f"🌿 Planner worktree {_team}")
    return _team


def cleanup() -> None:
    global _team, _path
    if _team is not None:
        agents.delete_team(_team)
        worktrees.remove_planner_worktree(_path)
        _team = None
        _path = None
