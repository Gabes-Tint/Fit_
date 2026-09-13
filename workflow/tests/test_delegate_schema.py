"""Unit tests pinning schemas/delegate.json to selection.py and
assignment.py's retained-input ref grammar, so the two cannot drift apart
silently (delegation-contract.md, Selection gate and Assignment envelope)."""

import json
import re
from pathlib import Path

from fitflow.runstate import retained_inputs
from fitflow.selection import SIGNAL_NAMES

SCHEMA_PATH = Path(__file__).parent.parent / "fitflow" / "schemas" / "delegate.json"


def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def _evidence_item_schema() -> dict:
    return _schema()["properties"]["slices"]["items"]["properties"]["evidence"]["items"]


def test_evidence_signal_enum_matches_signal_names():
    enum = _evidence_item_schema()["properties"]["signal"]["enum"]
    assert enum == list(SIGNAL_NAMES)


def test_evidence_source_ref_pattern_accepts_every_retained_ref():
    pattern = re.compile(_evidence_item_schema()["properties"]["source_ref"]["pattern"])
    for story_number in (1, 140, 399):
        for layer in ("domain", "ui"):
            for acceptance_count in (0, 1, 5):
                retained = retained_inputs(story_number, layer, acceptance_count)
                for ref in retained.resolvable_refs:
                    assert pattern.match(ref), f"pattern rejected retained ref {ref!r}"


def test_evidence_source_ref_pattern_rejects_comma_joined_indices():
    pattern = re.compile(_evidence_item_schema()["properties"]["source_ref"]["pattern"])
    assert pattern.match("run-399/ui/acceptance/0,1,2,3,4") is None


def test_evidence_source_ref_pattern_rejects_unknown_shapes():
    pattern = re.compile(_evidence_item_schema()["properties"]["source_ref"]["pattern"])
    for bad in (
        "run-399/ui/acceptance/",
        "run-399/ui/acceptance",
        "run-399/ui/acceptance/01",
        "run-0/ui/brief",
        "run-399/backend/brief",
        "run-399/ui/needs_sibling",
        "run-399/ownership/extra",
    ):
        assert pattern.match(bad) is None, f"pattern accepted invalid ref {bad!r}"
