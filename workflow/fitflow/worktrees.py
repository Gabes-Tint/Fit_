"""The only module that shells out to `git` and `bun`. One worktree per
issue, on branch `issue-<n>`, created once with `bun run worktree:new` and
reused by every later run that touches that issue.
"""

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


def worktree_path(name: str) -> Path:
    return settings.FIT_REPO / ".claude" / "worktrees" / name


def create_worktree(name: str) -> Path:
    """`bun run worktree:new <name>` in the repo root; installs and creates
    the branch `<name>` from `origin/main`."""
    _run_checked(["bun", "run", "worktree:new", name], cwd=settings.FIT_REPO)
    return worktree_path(name)


def current_branch(worktree: Path) -> str:
    return _git("rev-parse", "--abbrev-ref", "HEAD", cwd=worktree).stdout.strip()


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
