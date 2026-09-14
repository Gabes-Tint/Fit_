"""What the driver reads off a worktree with `git`. The flow tests cover
the rest of this module through go.py; these are the two file lists a turn
is judged against and the two shapes a failing command takes, asked
directly, because the difference between them is what whole runs of #420
and #422 were lost to.
"""

import subprocess
from pathlib import Path

import pytest

from fitflow import worktrees


def _git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A worktree with one commit: `tracked.ts` and `spec.ts`."""
    path = tmp_path / "slice"
    path.mkdir()
    _git("init", "--initial-branch=main", cwd=path)
    _git("config", "user.email", "driver@invalid", cwd=path)
    _git("config", "user.name", "driver", cwd=path)
    (path / "tracked.ts").write_text("export const one = 1;\n")
    (path / "spec.ts").write_text("// the acceptance test\n")
    _git("add", "-A", cwd=path)
    _git("commit", "-m", "base", cwd=path)
    return path


def _head(path: Path) -> str:
    return worktrees.local_head(path)


def test_changed_between_sees_a_tracked_file_modified_but_not_committed(repo: Path) -> None:
    """#420 run 3: the fix turn edited a tracked spec and committed
    nothing, so a `ref..HEAD` range called the file it named a phantom and
    failed a turn every gate had passed."""
    base = _head(repo)
    (repo / "tracked.ts").write_text("export const one = 2;\n")
    _git("add", "-A", cwd=repo)
    _git("commit", "-m", "frozen", cwd=repo)
    (repo / "spec.ts").write_text("// the acceptance test, corrected\n")

    assert sorted(worktrees.changed_between(repo, base)) == ["spec.ts", "tracked.ts"]


def test_changed_between_lists_each_path_once(repo: Path) -> None:
    """A file committed on top of the ref and modified again since is one
    changed file, not two."""
    base = _head(repo)
    (repo / "tracked.ts").write_text("export const one = 2;\n")
    _git("add", "-A", cwd=repo)
    _git("commit", "-m", "frozen", cwd=repo)
    (repo / "tracked.ts").write_text("export const one = 3;\n")

    assert worktrees.changed_between(repo, base) == ["tracked.ts"]


def test_changed_between_carries_deletions_renames_and_untracked_files(repo: Path) -> None:
    """The three shapes `changed_since` reports the same way: a deleted
    path by its own name, a rename by its new one, and a file git has
    never seen."""
    base = _head(repo)
    _git("rm", "--quiet", "spec.ts", cwd=repo)
    _git("mv", "tracked.ts", "renamed.ts", cwd=repo)
    (repo / "added.ts").write_text("export const added = true;\n")

    assert sorted(worktrees.changed_between(repo, base)) == ["added.ts", "renamed.ts", "spec.ts"]


def test_changed_since_still_reads_the_working_tree_alone(repo: Path) -> None:
    """The other half of the pair is untouched: at the failing-test commit
    a turn is judged by what its own working tree holds."""
    base = _head(repo)
    (repo / "tracked.ts").write_text("export const one = 2;\n")
    (repo / "added.ts").write_text("export const added = true;\n")

    assert sorted(worktrees.changed_since(repo, base)) == ["added.ts", "tracked.ts"]


def test_commit_all_on_a_clean_tree_keeps_the_head_it_has(repo: Path) -> None:
    """#422 run 5: the driver asked for a commit of a tree with nothing in
    it, `git commit` exited 1 saying so, and the run died on it. Nothing to
    commit means the worktree is already at the commit the caller wanted."""
    head = _head(repo)

    assert worktrees.commit_all(repo, "feat: nothing to do") == head
    assert _head(repo) == head


def test_commit_all_still_raises_when_the_commit_really_fails(repo: Path) -> None:
    """Tolerating an empty commit is not tolerating a failed one: a hook
    that refuses the commit still stops the driver, with its own words."""
    hook = repo / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\necho 'the hook refused it' >&2\nexit 1\n")
    hook.chmod(0o755)
    (repo / "tracked.ts").write_text("export const one = 2;\n")

    with pytest.raises(RuntimeError) as failure:
        worktrees.commit_all(repo, "feat: refused")

    assert "the hook refused it" in str(failure.value)


def test_a_failed_command_reports_both_streams(repo: Path) -> None:
    """#422 run 5's diagnostic showed a pre-commit hook's passing output and
    not git's own reason: the message kept whichever stream it found first.
    Both are reported now, stderr first and stdout after it."""
    with pytest.raises(RuntimeError) as failure:
        worktrees._run_checked(
            ["sh", "-c", "echo the reason; echo the noise >&2; exit 1"], cwd=repo
        )

    message = str(failure.value)
    assert "stderr: the noise" in message
    assert "stdout: the reason" in message
    assert message.index("stderr:") < message.index("stdout:")
