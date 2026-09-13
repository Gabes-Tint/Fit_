"""Unit tests for implement._escalate_or_stop: a rejected escalation
envelope must never leave the persisted record showing a successor role
that never ran (issue: the mutation used to happen before validation)."""

import pytest

from fitflow import agents
from fitflow.agent_config import AgentConfig
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord
from fitflow.steps.implement import _escalate_or_stop

_ROSTER = {
    "mechanic": AgentConfig("claude", "mechanic-model", "low"),
    "builder": AgentConfig("claude", "builder-model", "medium"),
}


@pytest.fixture(autouse=True)
def _roster(monkeypatch):
    monkeypatch.setattr(agents, "_roster", dict(_ROSTER))
    yield


def _piece(**overrides) -> SliceRecord:
    payload = dict(
        number=7,
        layer="domain",
        title="t",
        slug="story-7-domain",
        branch="story-7-domain",
        team="story-7-domain",
        worktree="/repo/.claude/worktrees/story-7-domain",
        brief="b",
        acceptance=["only criterion"],
        test_kind="vitest",
        test_files=["src/lib/t.spec.ts"],
        failing_sha="deadbeef",
        role="mechanic",
        revision=0,
        attempts=3,
        state="validating",
        assignments=[
            {
                "version": 1,
                "slice_ref": "run-7/domain",
                "revision": 0,
                "role": "mechanic",
                "config": {"backend": "claude", "model": "mechanic-model", "effort": "low"},
                "signals": {
                    "objective_clear": True,
                    "area_known": True,
                    "pattern_known": True,
                    "procedure_complete": True,
                    "solution_uncertain": False,
                    "cause_uncertain": False,
                    "technical_choice": "none",
                    "sensitive_areas": [],
                    "human_decision": False,
                },
                "evidence": overrides.pop("evidence", None) or [],
                "reason": "Selection row 4: fully specified procedure.",
            }
        ],
    )
    payload.update(overrides)
    return SliceRecord(**payload)


def _record(piece: SliceRecord) -> RunRecord:
    return RunRecord(
        story_number=7,
        base_sha="x",
        config={role: cfg.__dict__ for role, cfg in _ROSTER.items()},
        slices={"domain": piece},
    )


def test_a_rejected_escalation_leaves_the_exhausted_role_failed() -> None:
    # An evidence source_ref that does not resolve against the retained
    # inputs of this slice (only one acceptance criterion exists) makes
    # assignment.validate_envelope reject the escalation envelope.
    bad_evidence = [
        {
            "signal": name,
            "source_ref": "run-7/domain/acceptance/9",
            "detail": "irrelevant",
        }
        for name in (
            "objective_clear",
            "area_known",
            "pattern_known",
            "procedure_complete",
            "solution_uncertain",
            "cause_uncertain",
            "technical_choice",
            "sensitive_areas",
            "human_decision",
        )
    ]
    piece = _piece(evidence=bad_evidence)
    record = _record(piece)

    with pytest.raises(FlowFailure) as excinfo:
        _escalate_or_stop(record, piece, "diagnostic: it never passed")

    assert excinfo.value.outcome is Outcome.PLAN_REJECTED
    # the piece stays the exhausted role at revision 0, not a successor
    # that never ran
    assert piece.role == "mechanic"
    assert piece.revision == 0
    assert piece.attempts == 3
    assert piece.state == "failed"
    assert len(piece.assignments) == 1


def test_a_valid_escalation_mutates_only_after_it_is_accepted() -> None:
    good_evidence = [
        {
            "signal": name,
            "source_ref": "run-7/domain/brief",
            "detail": "irrelevant",
        }
        for name in (
            "objective_clear",
            "area_known",
            "pattern_known",
            "procedure_complete",
            "solution_uncertain",
            "cause_uncertain",
            "technical_choice",
            "sensitive_areas",
            "human_decision",
        )
    ]
    piece = _piece(evidence=good_evidence)
    record = _record(piece)

    _escalate_or_stop(record, piece, "diagnostic: it never passed")

    assert piece.role == "builder"
    assert piece.revision == 1
    assert piece.attempts == 0
    assert piece.state == "assigned"
    assert len(piece.assignments) == 2
    assert piece.assignments[-1]["role"] == "builder"
