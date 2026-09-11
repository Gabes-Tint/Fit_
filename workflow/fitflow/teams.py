"""An issue's team: one aarmy team per issue, `issue-<n>`, whose `worktree`
entry is a symlink to the real git worktree on branch `issue-<n>`. Teams are
never deleted by block 1 - a rerun resumes the same sessions in the same
worktree, so this module only ever creates a team the first time an issue
is touched and reuses it every time after.
"""

from dataclasses import dataclass
from pathlib import Path

from fitflow import agents, audit, narrate, settings, worktrees
from fitflow.outcome import FlowFailure, Outcome


@dataclass
class Team:
    name: str
    worktree: Path


def for_issue(number: int) -> Team:
    name = f"issue-{number}"
    branch = name
    path = worktrees.worktree_path(name)
    if path.exists():
        _check_reusable(path, branch, number)
        _link(name, path)
        narrate.line(f"👥 Team {name} · reused worktree")
        _narrate_roles(name)
        return Team(name, path)
    path = worktrees.create_worktree(name)
    _link(name, path)
    audit.worktree_created(name)
    narrate.line(f"👥 Team {name} · new worktree")
    return Team(name, path)


def _check_reusable(worktree: Path, branch: str, number: int) -> None:
    current = worktrees.current_branch(worktree)
    if current != branch:
        raise FlowFailure(
            Outcome.WORKTREE_NOT_REUSABLE,
            f"issue-{number}'s worktree is on branch {current!r}, not {branch!r}",
            number,
        )
    if not worktrees.is_clean(worktree):
        raise FlowFailure(
            Outcome.WORKTREE_NOT_REUSABLE,
            f"issue-{number}'s worktree has uncommitted changes",
            number,
        )


def _link(name: str, worktree: Path) -> None:
    team_dir = settings.TEAMS_DIR / name
    team_dir.mkdir(parents=True, exist_ok=True)
    link = team_dir / "worktree"
    if link.is_symlink() or link.exists():
        if link.resolve() == worktree.resolve():
            return
        link.unlink()
    link.symlink_to(worktree)


def verify_left_clean(team: Team, number: int) -> None:
    """A planner turn runs in the issue's own worktree - it must never leave
    changes behind for the next turn (or the mechanic) to trip over."""
    if not worktrees.is_clean(team.worktree):
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT, "planner left changes in the worktree", number
        )


def _narrate_roles(name: str) -> None:
    roles = agents.existing_roles(name)
    if roles is None:
        narrate.line("   │ existing roles: (could not list)")
    else:
        narrate.line(f"   │ existing roles: {', '.join(roles) or '(none yet)'}")
