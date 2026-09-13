"""Unit tests for assignment envelope validation (delegation-contract.md,
'Proposed assignment envelope')."""

import pytest

from fitflow.agent_config import AgentConfig
from fitflow.assignment import AssignmentError, RetainedInputs, validate_envelope
from fitflow.selection import SIGNAL_NAMES

CONFIG = AgentConfig("claude", "configured-basic-model", "low")


def _envelope(**overrides) -> dict:
    payload = {
        "version": 1,
        "slice_ref": "run-140/domain",
        "revision": 0,
        "role": "mechanic",
        "config": {"backend": "claude", "model": "configured-basic-model", "effort": "low"},
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
        "evidence": [
            {
                "signal": name,
                "source_ref": "run-140/domain/brief",
                "detail": f"confirms {name} from the slice brief",
            }
            for name in SIGNAL_NAMES
        ],
        "reason": "Selection row 4: fully specified procedure.",
    }
    payload.update(overrides)
    return payload


def _retained() -> RetainedInputs:
    return RetainedInputs(
        slice_ref="run-140/domain",
        resolvable_refs=frozenset(
            {
                "run-140/domain/brief",
                "run-140/domain/acceptance/0",
                "run-140/domain/issue_context",
                "run-140/domain/failing_tests",
                "run-140/domain/branch",
                "run-140/domain/worktree",
                "run-140/domain/team",
                "run-140/ownership",
            }
        ),
    )


def _validate(payload, role="mechanic", revision=0) -> None:
    validate_envelope(payload, role=role, revision=revision, config=CONFIG, retained=_retained())


def _entry(index: int = 0, **changes) -> dict:
    payload = _envelope()
    payload["evidence"][index].update(changes)
    return payload


def test_valid_envelope_passes():
    assert _validate(_envelope()) is None


def test_extra_top_level_key_is_rejected():
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(worktree="/tmp/other"))

    assert "unknown field" in str(error.value)
    assert "worktree" in str(error.value)


def test_missing_top_level_key_is_rejected():
    payload = _envelope()
    del payload["reason"]

    with pytest.raises(AssignmentError) as error:
        _validate(payload)

    assert "missing field" in str(error.value)
    assert "reason" in str(error.value)


@pytest.mark.parametrize(
    "version,diagnostic",
    [(2, "assignment.version must be exactly 1"), (True, "assignment.version must be exactly 1")],
)
def test_bad_version_is_rejected(version, diagnostic):
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(version=version))

    assert diagnostic in str(error.value)


@pytest.mark.parametrize(
    "revision,argument,diagnostic",
    [
        (3, 0, "must be between 0 and 2"),
        (True, 0, "must be an integer"),
        (-1, 0, "must be between 0 and 2"),
        (1, 0, "does not match the assigned revision"),
    ],
)
def test_bad_revision_is_rejected(revision, argument, diagnostic):
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(revision=revision), revision=argument)

    assert diagnostic in str(error.value)


@pytest.mark.parametrize(
    "slice_ref,diagnostic",
    [
        ("run-140/ui", "does not match the retained slice"),
        ("", "must be a non-empty string"),
        (5, "must be a non-empty string"),
    ],
)
def test_bad_slice_ref_is_rejected(slice_ref, diagnostic):
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(slice_ref=slice_ref))

    assert diagnostic in str(error.value)


def test_role_mismatch_with_argument_is_rejected():
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(role="builder"))

    assert "does not match the assigned role" in str(error.value)


def test_unknown_role_is_rejected():
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(role="reviewer"), role="reviewer")

    assert "must be one of mechanic, builder, solver" in str(error.value)
    assert "reviewer" in str(error.value)


@pytest.mark.parametrize(
    "config,diagnostic",
    [
        (
            {"backend": "claude", "model": "configured-basic-model", "effort": "low", "timeout": 5},
            "assignment.config has unknown key timeout",
        ),
        (
            {"backend": "claude", "model": "configured-basic-model"},
            "assignment.config is missing key effort",
        ),
        (
            {"backend": 3, "model": "configured-basic-model", "effort": "low"},
            "must be a non-empty string",
        ),
        (
            {"backend": "", "model": "configured-basic-model", "effort": "low"},
            "must be a non-empty string",
        ),
        (
            {"backend": "claude", "model": "other-model", "effort": "low"},
            "assignment.config.model does not match the assigned config",
        ),
    ],
)
def test_bad_config_is_rejected(config, diagnostic):
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(config=config))

    assert diagnostic in str(error.value)


@pytest.mark.parametrize(
    "signals,diagnostic",
    [
        (
            {
                "objective_clear": True,
                "pattern_known": True,
                "procedure_complete": True,
                "solution_uncertain": False,
                "cause_uncertain": False,
                "technical_choice": "none",
                "sensitive_areas": [],
                "human_decision": False,
            },
            "missing signals: area_known",
        ),
        (
            {
                "objective_clear": True,
                "area_known": True,
                "pattern_known": True,
                "procedure_complete": True,
                "solution_uncertain": False,
                "cause_uncertain": False,
                "technical_choice": "none",
                "sensitive_areas": [],
                "human_decision": False,
                "diff_lines": 400,
            },
            "unknown signals: diff_lines",
        ),
        (
            {
                "objective_clear": 1,
                "area_known": True,
                "pattern_known": True,
                "procedure_complete": True,
                "solution_uncertain": False,
                "cause_uncertain": False,
                "technical_choice": "none",
                "sensitive_areas": [],
                "human_decision": False,
            },
            "must be a boolean",
        ),
        (
            {
                "objective_clear": True,
                "area_known": True,
                "pattern_known": True,
                "procedure_complete": True,
                "solution_uncertain": False,
                "cause_uncertain": False,
                "technical_choice": "maybe",
                "sensitive_areas": [],
                "human_decision": False,
            },
            "technical_choice",
        ),
    ],
)
def test_bad_signals_are_rejected(signals, diagnostic):
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(signals=signals))

    assert "assignment signals invalid" in str(error.value)
    assert diagnostic in str(error.value)


@pytest.mark.parametrize(
    "payload,diagnostic",
    [
        (_envelope(evidence=[]), "must be a non-empty array"),
        (_entry(extra=1), "assignment.evidence[0] has unknown key extra"),
        (
            _envelope(evidence=[{"signal": "area_known", "source_ref": "run-140/domain/brief"}]),
            "is missing key detail",
        ),
        (_entry(detail=""), "assignment.evidence[0].detail must be a non-empty string"),
        (_entry(signal="foo"), "assignment.evidence[0].signal must be one of"),
        (
            _entry(source_ref="run-9/ui/phantom"),
            "does not resolve to retained input: run-9/ui/phantom",
        ),
    ],
)
def test_bad_evidence_entry_is_rejected(payload, diagnostic):
    with pytest.raises(AssignmentError) as error:
        _validate(payload)

    assert diagnostic in str(error.value)


def test_signal_without_covering_evidence_is_rejected():
    payload = _envelope()
    del payload["evidence"][0]

    with pytest.raises(AssignmentError) as error:
        _validate(payload)

    assert "assignment.evidence has no entry for signal objective_clear" in str(error.value)


@pytest.mark.parametrize(
    "reason,diagnostic",
    [
        ("", "assignment.reason must be a non-empty string"),
        ("   ", "assignment.reason must be a non-empty string"),
        (7, "assignment.reason must be a non-empty string"),
    ],
)
def test_bad_reason_is_rejected(reason, diagnostic):
    with pytest.raises(AssignmentError) as error:
        _validate(_envelope(reason=reason))

    assert diagnostic in str(error.value)
