"""Unit tests for the review gate: the mechanical predicate, the reviewer
reply contract, and findings routing."""

import pytest
from conftest import builder_signals, mechanic_signals, solver_signals

from fitflow.review import (
    Finding,
    ReviewContractError,
    ReviewError,
    is_mechanical,
    route_findings,
    validate_reply,
)
from fitflow.runstate import RunRecord, SliceRecord


def _record(**per_layer_signals) -> RunRecord:
    slices = {}
    for layer, signals in per_layer_signals.items():
        slices[layer] = SliceRecord(
            number=1000,
            layer=layer,
            title=f"{layer} work",
            slug=f"story-1000-{layer}",
            branch=f"story-1000-{layer}",
            team=f"story-1000-{layer}",
            worktree=f"/tmp/story-1000-{layer}",
            brief="brief",
            acceptance=["observable"],
            test_kind="vitest",
            test_files=["src/lib/x.spec.ts"],
            failing_sha="a" * 40,
            role="mechanic",
            assignments=[
                {
                    "version": 1,
                    "slice_ref": f"run-1000/{layer}",
                    "revision": 0,
                    "role": "mechanic",
                    "config": {"backend": "claude", "model": "haiku", "effort": "low"},
                    "signals": signals,
                    "evidence": [],
                    "reason": "row",
                }
            ],
        )
    return RunRecord(
        story_number=1000,
        base_sha="b" * 40,
        config={"mechanic": {"backend": "claude", "model": "haiku", "effort": "low"}},
        slices=slices,
    )


def test_mechanical_requires_row_four_for_every_slice():
    assert is_mechanical(_record(domain=mechanic_signals()))
    assert not is_mechanical(_record(domain=builder_signals()))
    assert not is_mechanical(_record(domain=solver_signals()))
    assert not is_mechanical(
        _record(
            domain=mechanic_signals(),
            ui=mechanic_signals(sensitive_areas=["auth"]),
        )
    )
    assert is_mechanical(
        _record(domain=mechanic_signals(), ui=mechanic_signals())
    )


def test_reply_validation_accepts_merge_and_fix():
    verdict, findings = validate_reply({"verdict": "merge", "findings": []}, ["src/lib/x.ts"])
    assert verdict == "merge" and findings == []
    verdict, findings = validate_reply(
        {
            "verdict": "fix",
            "findings": [
                {
                    "file": "src/lib/x.ts",
                    "line": 3,
                    "category": "correctness",
                    "required_fix": "do the other thing",
                }
            ],
        },
        ["src/lib/x.ts"],
    )
    assert findings == [
        Finding("src/lib/x.ts", 3, "correctness", "do the other thing")
    ]


def test_reply_validation_rejects_malformed_replies():
    with pytest.raises(ReviewError):
        validate_reply({"verdict": "approve", "findings": []}, [])
    with pytest.raises(ReviewError):
        validate_reply({"verdict": "merge"}, [])
    with pytest.raises(ReviewError):
        validate_reply({"verdict": "fix", "findings": []}, ["src/lib/x.ts"])
    with pytest.raises(ReviewError):
        validate_reply(
            {
                "verdict": "fix",
                "findings": [
                    {
                        "file": "src/lib/x.ts",
                        "line": 0,
                        "category": "correctness",
                        "required_fix": "x",
                    }
                ],
            },
            ["src/lib/x.ts"],
        )
    with pytest.raises(ReviewError):
        validate_reply(
            {
                "verdict": "fix",
                "findings": [
                    {
                        "file": "src/lib/x.ts",
                        "line": 1,
                        "category": "style",
                        "required_fix": "x",
                    }
                ],
            },
            ["src/lib/x.ts"],
        )


def test_a_phantom_finding_breaks_the_review_contract():
    with pytest.raises(ReviewContractError):
        validate_reply(
            {
                "verdict": "fix",
                "findings": [
                    {
                        "file": "src/lib/phantom.ts",
                        "line": 1,
                        "category": "correctness",
                        "required_fix": "x",
                    }
                ],
            },
            ["src/lib/x.ts"],
        )


def test_findings_route_to_the_owning_layer_in_domain_then_ui_order():
    record = _record(domain=mechanic_signals(), ui=mechanic_signals())
    affected = route_findings(
        record,
        [
            Finding("src/lib/ui/Button.svelte", 1, "correctness", "x"),
            Finding("src/lib/domain/model.ts", 2, "security", "y"),
        ],
    )
    assert affected == ["domain", "ui"]


def test_a_finding_outside_every_slice_breaks_the_contract():
    record = _record(domain=mechanic_signals())
    with pytest.raises(ReviewContractError):
        route_findings(
            record,
            [Finding("src/routes/you/+page.svelte", 1, "contract", "x")],
        )
