"""Every schema the driver hands `aarmy --schema` is in codex's strict subset.

#430 added an optional `objection` object to `implementation.json`. The fake
`aarmy` took it, all 425 tests passed, and every real block 3 launch of the
#406 run died before the agent started: aarmy refuses a schema whose object
does not list every property in `required`. These tests run the same rule the
fake now applies (`tests/fakes/strict_schema.py`, mirroring agents-army-2's
`orchestrator/schema.py`) over every document in `fitflow/schemas/`, so the
next lax schema fails here instead of in a real run.
"""

import importlib.util
import json
from pathlib import Path

import pytest

SCHEMAS_DIR = Path(__file__).parent.parent / "fitflow" / "schemas"
HELPER = Path(__file__).parent / "fakes" / "strict_schema.py"


def _helper():
    """Loaded by path, exactly as the fake `aarmy` loads it: `tests/fakes` is
    a directory of executables on PATH, not an importable package."""
    spec = importlib.util.spec_from_file_location("fake_strict_schema", HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


first_violation = _helper().first_violation


def _schemas() -> list[Path]:
    found = sorted(SCHEMAS_DIR.glob("*.json"))
    assert found, f"no schemas under {SCHEMAS_DIR}"
    return found


@pytest.mark.parametrize("path", _schemas(), ids=lambda path: path.name)
def test_every_schema_is_in_the_strict_subset(path: Path) -> None:
    assert first_violation(json.loads(path.read_text())) is None


def test_a_property_missing_from_required_is_the_failure_that_shipped() -> None:
    """The exact #430 shape, and the exact message the real run printed."""
    lax = {
        "type": "object",
        "additionalProperties": False,
        "required": ["changed_files"],
        "properties": {"changed_files": {"type": "array"}, "objection": {"type": "string"}},
    }
    assert first_violation(lax) == (
        "$ must list every property in \"required\"; missing 'objection' "
        "(codex rejects it; one schema has to mean the same thing on every backend)"
    )


def test_the_rule_reaches_nested_objects_and_items() -> None:
    nested = {
        "type": "object",
        "additionalProperties": False,
        "required": ["rows"],
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["a"],
                    "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
                },
            }
        },
    }
    assert "$.properties.rows.items must list every property" in first_violation(nested)


def test_a_nullable_object_still_has_to_be_strict() -> None:
    """`"type": ["object", "null"]` is how the implementer schema keeps the
    objection optional in meaning; it buys no exemption from the rules."""
    document = {
        "type": "object",
        "additionalProperties": False,
        "required": ["objection"],
        "properties": {
            "objection": {
                "type": ["object", "null"],
                "required": ["why"],
                "properties": {"why": {"type": "string"}},
            }
        },
    }
    assert "$.properties.objection must set" in first_violation(document)


def test_an_unsupported_keyword_is_named() -> None:
    document = {
        "type": "object",
        "additionalProperties": False,
        "required": ["v"],
        "properties": {"v": {"oneOf": [{"type": "string"}]}},
    }
    assert '$.properties.v uses "oneOf"' in first_violation(document)
