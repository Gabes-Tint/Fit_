"""Unit tests for the slice state machine (runstate.SliceRecord.move)."""

import pytest

from fitflow.runstate import SliceRecord


def _record(**overrides) -> SliceRecord:
    payload = dict(
        number=140,
        layer="domain",
        title="a slice",
        slug="story-140-domain",
        branch="story-140-domain",
        team="story-140-domain",
        worktree="/repo/.claude/worktrees/story-140-domain",
        brief="do the thing",
        acceptance=["it works"],
        test_kind="vitest",
        test_files=["src/lib/thing.spec.ts"],
        failing_sha="deadbeef",
    )
    payload.update(overrides)
    return SliceRecord(**payload)


def test_initial_state_is_assigned() -> None:
    assert _record().state == "assigned"


def test_the_documented_level_loop_is_allowed() -> None:
    piece = _record()
    piece.move("running")
    piece.move("validating")
    piece.move("correcting")
    piece.move("running")
    piece.move("validating")
    piece.move("succeeded")
    assert piece.state == "succeeded"


def test_escalation_passes_through_escalating_before_assigned() -> None:
    piece = _record()
    piece.move("running")
    piece.move("validating")
    piece.move("escalating")
    piece.move("assigned")
    assert piece.state == "assigned"


def test_review_fix_reopens_a_succeeded_slice() -> None:
    piece = _record()
    piece.move("running")
    piece.move("validating")
    piece.move("succeeded")
    piece.move("fixing")
    piece.move("validating")
    assert piece.state == "validating"


def test_prohibited_transition_raises() -> None:
    piece = _record()
    with pytest.raises(RuntimeError, match=r"prohibited slice transition assigned → validating"):
        piece.move("validating")


def test_terminal_states_admit_no_further_transition() -> None:
    piece = _record()
    piece.move("running")
    piece.move("failed")
    with pytest.raises(RuntimeError, match=r"prohibited slice transition failed → running"):
        piece.move("running")
