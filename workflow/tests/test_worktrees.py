"""What the driver reads off a worktree with `git`. The flow tests cover
the rest of this module through go.py; these are the two file lists a turn
is judged against, asked directly, because the difference between them is
what a whole run of #420 was lost to.
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
