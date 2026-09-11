"""The only module that shells out to `git` and `bun`. Two kinds of worktree:
the planner's own (cheap, detached, no install) and a slice's (via `bun run
worktree:new`, which installs dependencies and creates the branch).
"""

import shutil
import subprocess
from pathlib import Path

from fitflow import settings


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def _run_checked(cmd: list[str], cwd: Path) -> str:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"{' '.join(cmd)} (in {cwd}) failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout


def fetch_origin() -> None:
    _run_checked(["git", "fetch", "origin"], cwd=settings.FIT_REPO)


def planner_worktree(plan_id: str) -> Path:
    """A cheap, detached worktree at origin/main - no `bun install`. A
    leftover from a killed run is cleared first, so it never poisons this
    one: `worktree remove --force` the path (if git still tracks it) and
    `worktree prune` (in case it does not).
    """
    path = settings.FIT_REPO / ".claude" / "worktrees" / f"plan-{plan_id}"
    subprocess.run(
        ["git", "worktree", "remove", "--force", str(path)],
        cwd=settings.FIT_REPO,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        ["git", "worktree", "prune"], cwd=settings.FIT_REPO, capture_output=True, text=True
    )
    if path.exists():
        # Not a worktree git ever knew about (a plain leftover directory) -
        # the two commands above only clean up what git itself is tracking.
        shutil.rmtree(path, ignore_errors=True)
    _run_checked(
        ["git", "worktree", "add", "--detach", str(path), "origin/main"],
        cwd=settings.FIT_REPO,
    )
    return path


def remove_planner_worktree(path: Path) -> None:
    """Removed on every exit, including failure."""
    subprocess.run(
        ["git", "worktree", "remove", "--force", str(path)],
        cwd=settings.FIT_REPO,
        capture_output=True,
        text=True,
    )


def slice_worktree_path(slug: str) -> Path:
    return settings.FIT_REPO / ".claude" / "worktrees" / slug


def slice_worktree_exists(slug: str) -> bool:
    """True if the worktree directory or the branch already exists."""
    if slice_worktree_path(slug).exists():
        return True
    branch = _git("show-ref", "--verify", "--quiet", f"refs/heads/{slug}", cwd=settings.FIT_REPO)
    return branch.returncode == 0


def create_slice_worktree(slug: str) -> Path:
    """`bun run worktree:new <slug>` in the repo root; installs and creates
    the branch `<slug>` from `origin/main`."""
    _run_checked(["bun", "run", "worktree:new", slug], cwd=settings.FIT_REPO)
    return slice_worktree_path(slug)


def remove_slice_worktree(path: Path) -> None:
    subprocess.run(
        ["git", "worktree", "remove", "--force", str(path)],
        cwd=settings.FIT_REPO,
        capture_output=True,
        text=True,
    )


def is_clean(worktree: Path) -> bool:
    status = _git("status", "--porcelain", cwd=worktree)
    return status.stdout.strip() == ""


def local_head(worktree: Path) -> str:
    return _git("rev-parse", "HEAD", cwd=worktree).stdout.strip()


def remote_head(branch: str) -> str | None:
    """The sha `origin/<branch>` points to, or None if it does not exist."""
    result = _git("ls-remote", "origin", branch, cwd=settings.FIT_REPO)
    line = result.stdout.strip()
    if not line:
        return None
    return line.split()[0]


def changed_files(worktree: Path, branch: str) -> list[str]:
    """Files touched on `branch` relative to `origin/main`."""
    result = _git("diff", "--name-only", f"origin/main...{branch}", cwd=worktree)
    return [line for line in result.stdout.splitlines() if line]
