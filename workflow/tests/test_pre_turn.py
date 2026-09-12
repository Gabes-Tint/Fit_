"""Unit tests for the per-turn barrier: it must hold before every turn,
not only before the first one."""

import fcntl
import subprocess
from pathlib import Path

import pytest

from fitflow import settings
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord, lock_path
from fitflow.steps.implement import _pre_turn_barrier


def _init_repo(path: Path, branch: str) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", branch, "."], cwd=path, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=path, check=True)
    (path / "seed.txt").write_text("seed\n")
    subprocess.run(["git", "add", "-A"], cwd=path, check=True)
    subprocess.run(["git", "commit", "-qm", "seed"], cwd=path, check=True)
    return path


@pytest.fixture
def slice_world(tmp_path, monkeypatch):
    """A real git worktree for one slice whose story lock is exclusively
    held by the run, the way go.py holds it."""
    repo = tmp_path / "repo"
    worktree = _init_repo(repo / ".claude" / "worktrees" / "story-7-domain", "story-7-domain")
    monkeypatch.setattr(settings, "FIT_REPO", repo)
    monkeypatch.setattr(settings, "FIT_FLOW_HOME", tmp_path / "flow-home")
    monkeypatch.setattr(settings, "TEAMS_DIR", tmp_path / "flow-home" / "teams")
    lock_path(7).parent.mkdir(parents=True, exist_ok=True)
    held = lock_path(7).open("w")
    fcntl.flock(held, fcntl.LOCK_EX)

    piece = SliceRecord(
        number=7,
        layer="domain",
        title="t",
        slug="story-7-domain",
        branch="story-7-domain",
        team="story-7-domain",
        worktree=str(worktree),
        brief="b",
        acceptance=["a"],
        test_kind="vitest",
        test_files=["src/lib/t.spec.ts"],
        failing_sha=subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=worktree, capture_output=True, text=True
        ).stdout.strip(),
        role="mechanic",
        revision=0,
        state="running",
        assignments=[
            {
                "role": "mechanic",
                "revision": 0,
                "config": {"backend": "claude", "model": "haiku", "effort": "low"},
            }
        ],
    )
    record = RunRecord(
        story_number=7,
        base_sha="x",
        config={"mechanic": {"backend": "claude", "model": "haiku", "effort": "low"}},
        slices={"domain": piece},
    )
    teams_dir = settings.TEAMS_DIR / "story-7-domain"
    teams_dir.mkdir(parents=True)
    (teams_dir / "worktree").symlink_to(worktree)
    yield record, piece, held
    held.close()


def test_pre_turn_barrier_passes_for_a_clean_settled_state(slice_world):
    record, piece, _held = slice_world

    _pre_turn_barrier(record, piece)


def test_assignment_role_mismatch_is_a_contract_failure(slice_world):
    record, piece, _held = slice_world
    piece.assignments[-1]["role"] = "builder"

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert error.value.outcome == Outcome.AGENT_BROKE_CONTRACT
    assert "does not match the slice's role/revision" in error.value.why


def test_configuration_drift_between_turns_is_a_contract_failure(slice_world):
    record, piece, _held = slice_world
    record.config["mechanic"]["model"] = "opus"

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "configuration changed since the assignment was accepted" in error.value.why


def test_wrong_branch_before_a_turn_is_a_contract_failure(slice_world):
    record, piece, _held = slice_world
    piece.branch = "story-999-domain"

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "team/branch/slug identities disagree" in error.value.why


def test_an_unsettled_previous_turn_blocks_the_next_launch(slice_world):
    record, piece, _held = slice_world
    piece.turns.append({"status": "running", "result": ""})

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "previous turn never settled" in error.value.why


def test_the_initial_launch_must_start_from_a_clean_worktree(slice_world):
    record, piece, _held = slice_world
    src = Path(piece.worktree) / "src"
    src.mkdir()
    (src / "partial.ts").write_text("dirty\n")

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "initial launch must start from a clean worktree" in error.value.why


def test_lost_exclusive_ownership_stops_the_turn(slice_world):
    record, piece, held = slice_world
    held.close()  # nobody holds the story flock any more: ownership was lost

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "exclusive ownership of story #7 was lost" in error.value.why


def test_a_missing_team_worktree_link_is_a_contract_failure(slice_world):
    record, piece, _held = slice_world
    (Path(settings.TEAMS_DIR) / "story-7-domain" / "worktree").unlink()

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "has no worktree link" in error.value.why


def test_a_replaced_team_link_is_a_contract_failure(slice_world):
    record, piece, _held = slice_world
    link = Path(settings.TEAMS_DIR) / "story-7-domain" / "worktree"
    link.unlink()
    decoy = Path(settings.FIT_REPO) / ".claude" / "worktrees" / "story-999-domain"
    decoy.mkdir(parents=True, exist_ok=True)
    link.symlink_to(decoy)

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "resolves to" in error.value.why
    assert "not the retained" in error.value.why


def test_a_link_pointing_outside_the_worktrees_root_is_a_contract_failure(slice_world):
    record, piece, _held = slice_world
    link = Path(settings.TEAMS_DIR) / "story-7-domain" / "worktree"
    link.unlink()
    escape = tmp_dir_outside(slice_world)
    link.symlink_to(escape)

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "resolves outside" in error.value.why


def tmp_dir_outside(slice_world):
    import tempfile

    return Path(tempfile.mkdtemp())


def test_identity_mismatch_between_team_slug_and_branch_is_a_contract_failure(slice_world):
    record, piece, _held = slice_world
    piece.branch = "story-999-domain"

    with pytest.raises(FlowFailure) as error:
        _pre_turn_barrier(record, piece)

    assert "team/branch/slug identities disagree" in error.value.why
