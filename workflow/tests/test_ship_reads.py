"""Unit tests for block 5's read-only lookups. A read that fails prints
nothing on stdout, which is exactly what "no tag" and "no such branch"
look like - so the failure has to be told apart from the absence."""

import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from fitflow import settings, worktrees
from fitflow.outcome import FlowFailure
from fitflow.steps.ship import _await_tag


def _init_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main", "."], cwd=path, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=path, check=True)
    (path / "seed.txt").write_text("seed\n")
    subprocess.run(["git", "add", "-A"], cwd=path, check=True)
    subprocess.run(["git", "commit", "-qm", "seed"], cwd=path, check=True)
    return path


@pytest.fixture
def repo(tmp_path, monkeypatch) -> Path:
    path = _init_repo(tmp_path / "repo")
    monkeypatch.setattr(settings, "FIT_REPO", path)
    return path


def test_tags_that_cannot_be_read_are_not_an_absent_tag(repo):
    """No `origin` at all stands for every way `ls-remote` fails."""
    with pytest.raises(worktrees.ReadError) as failure:
        worktrees.tags_at("0" * 40)

    assert "tags could not be read" in str(failure.value)


def test_a_branch_that_does_not_exist_is_still_an_empty_tip(repo):
    assert worktrees.branch_tip("never-created") == ""


def test_a_tip_that_cannot_be_read_is_raised(repo, tmp_path, monkeypatch):
    plain = tmp_path / "not-a-repository"
    plain.mkdir()
    monkeypatch.setattr(settings, "FIT_REPO", plain)

    with pytest.raises(worktrees.ReadError) as failure:
        worktrees.branch_tip("main")

    assert "tip of main could not be read" in str(failure.value)


def test_the_tag_timeout_says_when_origin_was_never_read(repo, monkeypatch):
    """`version-tag.yml` is blamed for a tag that never appeared, not for a
    lookup that never succeeded - they call for different people."""
    monkeypatch.setattr(settings, "MAIN_CI_TIMEOUT", 0)
    monkeypatch.setattr(settings, "CI_POLL_SECONDS", 0)

    with pytest.raises(FlowFailure) as failure:
        _await_tag(SimpleNamespace(story_number=1000), "d" * 40)

    assert "could not be read" in failure.value.why
    assert "only that origin could not be asked" in failure.value.why


def test_the_tag_timeout_blames_the_workflow_when_origin_answered(repo, monkeypatch):
    monkeypatch.setattr(settings, "MAIN_CI_TIMEOUT", 0)
    monkeypatch.setattr(settings, "CI_POLL_SECONDS", 0)
    monkeypatch.setattr(worktrees, "tags_at", lambda sha: [])

    with pytest.raises(FlowFailure) as failure:
        _await_tag(SimpleNamespace(story_number=1000), "d" * 40)

    assert "version-tag.yml should have tagged this merge" in failure.value.why
