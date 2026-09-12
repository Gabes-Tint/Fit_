"""The only module that shells out to `git` and `bun`. Two kinds of worktree:
the planner's own (cheap, detached, no install) and a slice's (via `bun run
worktree:new`, which installs dependencies and creates the branch).
"""

import os
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


def status_summary(worktree: Path) -> str:
    status = _git("status", "--porcelain", "--untracked-files=all", cwd=worktree).stdout.strip()
    if not status:
        return "clean"
    return f"dirty (preserved for audit): {status.replace(chr(10), '; ')}"


def local_head(worktree: Path) -> str:
    return _git("rev-parse", "HEAD", cwd=worktree).stdout.strip()


def current_branch(worktree: Path) -> str:
    return _git("rev-parse", "--abbrev-ref", "HEAD", cwd=worktree).stdout.strip()


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


def changed_since(worktree: Path, ref: str) -> list[str]:
    """Working-tree files changed (modified or untracked) since `ref`."""
    result = _git("status", "--porcelain", "--untracked-files=all", cwd=worktree)
    changed = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        changed.append(path.strip())
    return changed


def changed_between(worktree: Path, ref: str) -> list[str]:
    """Committed changes from `ref` to HEAD plus untracked working-tree
    files - the accumulated diff when the driver has already frozen a
    commit on top of `ref`."""
    result = _git("diff", "--name-only", f"{ref}..HEAD", cwd=worktree)
    committed = [line for line in result.stdout.splitlines() if line]
    untracked = []
    for line in _git(
        "status", "--porcelain", "--untracked-files=all", cwd=worktree
    ).stdout.splitlines():
        if line.startswith("??"):
            untracked.append(line[3:].strip())
    return committed + untracked


def content_at(worktree: Path, ref: str, path: str) -> str | None:
    """A file's bytes at `ref` in this worktree, or None if it did not exist."""
    result = _git("show", f"{ref}:{path}", cwd=worktree)
    return result.stdout if result.returncode == 0 else None


def commit_all(worktree: Path, message: str) -> str:
    """Driver-controlled local commit of the whole working tree; returns
    the new HEAD sha. Implementation agents never commit or push."""
    _run_checked(["git", "add", "-A"], cwd=worktree)
    _run_checked(["git", "commit", "-m", message], cwd=worktree)
    return local_head(worktree)


def integration_worktree_path(slug: str) -> Path:
    return settings.FIT_REPO / ".claude" / "worktrees" / slug


def branch_exists(branch: str) -> bool:
    result = _git("show-ref", "--verify", "--quiet", f"refs/heads/{branch}", cwd=settings.FIT_REPO)
    return result.returncode == 0


def create_integration_worktree(slug: str) -> Path:
    """A plain worktree on a new branch `slug` from `origin/main` - git only,
    no install: nothing runs gates here."""
    path = integration_worktree_path(slug)
    _run_checked(
        ["git", "worktree", "add", "-b", slug, str(path), "origin/main"],
        cwd=settings.FIT_REPO,
    )
    return path


def merge_commit(worktree: Path, sha: str) -> None:
    """Merge one frozen commit into the integration branch. A conflict
    raises CalledProcessError; the caller aborts and classifies."""
    _run_checked(["git", "merge", "--no-edit", sha], cwd=worktree)


def abort_merge(worktree: Path) -> None:
    subprocess.run(["git", "merge", "--abort"], cwd=worktree, capture_output=True, text=True)


def reset_to_origin_main(worktree: Path) -> None:
    """The driver's own integration worktree: re-point it at origin/main
    before re-merging frozen commits."""
    _run_checked(["git", "reset", "--hard", "origin/main"], cwd=worktree)


def is_ancestor(worktree: Path, sha: str) -> bool:
    result = _git("merge-base", "--is-ancestor", sha, "HEAD", cwd=worktree)
    return result.returncode == 0


def push_branch(worktree: Path, branch: str) -> None:
    _run_checked(["git", "push", "-u", "origin", branch], cwd=worktree)


def diff_files_against_main(worktree: Path, branch: str) -> list[str]:
    """Files the integration branch changes against origin/main."""
    result = _git("diff", "--name-only", f"origin/main...{branch}", cwd=worktree)
    return [line for line in result.stdout.splitlines() if line]


# --- Block 5: the release checkout, the deploys and the cleanup ----------------


def tags_at(sha: str) -> list[str]:
    """The `v*` tags origin has on one commit. Asked of the remote, not of
    this clone: `version-tag.yml` creates the tag seconds after the merge
    and nothing here has fetched it."""
    result = _git("ls-remote", "--tags", "origin", cwd=settings.FIT_REPO)
    tags = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) != 2 or parts[0] != sha:
            continue
        name = parts[1].removeprefix("refs/tags/").removesuffix("^{}")
        if name.startswith("v"):
            tags.append(name)
    return sorted(set(tags))


def create_release_worktree(slug: str, sha: str) -> Path:
    """An installed worktree at exactly one commit. `bun run worktree:new`
    for the install, then hard-reset off origin/main onto the commit being
    shipped - which is where the deploy's own `HEAD` check will look."""
    path = create_slice_worktree(slug)
    _run_checked(["git", "reset", "--hard", sha], cwd=path)
    return path


def is_ancestor_of(sha: str, descendant: str) -> bool:
    """Whether `sha` is reachable from `descendant`, asked of the repo."""
    result = _git("merge-base", "--is-ancestor", sha, descendant, cwd=settings.FIT_REPO)
    return result.returncode == 0


def _stream(cmd: list[str], cwd: Path, env: dict[str, str], on_line) -> tuple[int, list[str]]:
    """Run a command, narrating each line as it arrives. A deploy takes
    minutes; a silent wait says nothing about which step it is on."""
    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        env={**os.environ, **env},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        lines.append(line.rstrip())
        on_line(lines[-1])
    return process.wait(), lines


def run_deploy(worktree: Path, host: str, origin: str, tunnel: bool, on_line) -> int:
    """`bun run deploy`, with the target in the two variables
    `scripts/deploy/config.ts` reads and nothing else. `deploy.ts` runs the
    smoke check itself, so `deploy:smoke` is never a second invocation."""
    command = ["bun", "run", "deploy", *(["--tunnel"] if tunnel else [])]
    code, _ = _stream(
        command,
        worktree,
        {settings.DEPLOY_HOST_VARIABLE: host, settings.PUBLIC_ORIGIN_VARIABLE: origin},
        on_line,
    )
    return code


def run_android_release(worktree: Path, origin: str, on_line) -> tuple[int, list[str]]:
    """`bun run android:release`, pointed at an origin explicitly:
    `release-plan.ts` defaults the shell to production and reads the origin
    from `--server-url=`, not from the environment."""
    return _stream(
        ["bun", "run", "android:release", f"--server-url={origin}"],
        worktree,
        {},
        on_line,
    )


def worktree_done(slug: str, force: bool) -> tuple[int, str]:
    """`bun run worktree:done <slug>`; returns its exit code and output."""
    result = subprocess.run(
        ["bun", "run", "worktree:done", slug, *(["--force"] if force else [])],
        cwd=settings.FIT_REPO,
        capture_output=True,
        text=True,
    )
    return result.returncode, (result.stdout + result.stderr).strip()


def branch_tip(branch: str) -> str:
    """The commit a local branch points at, or "" if there is no such branch."""
    result = _git("rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", cwd=settings.FIT_REPO)
    return result.stdout.strip()


def delete_branch_at(branch: str, expected_sha: str) -> bool:
    """Delete a local branch, and only when its tip is still the commit the
    run recorded. `worktree:done` leaves these behind: main squashes, so
    they are never merged into origin/main by the test it applies."""
    tip = _git("rev-parse", branch, cwd=settings.FIT_REPO).stdout.strip()
    if tip != expected_sha:
        return False
    return _git("branch", "-D", branch, cwd=settings.FIT_REPO).returncode == 0
