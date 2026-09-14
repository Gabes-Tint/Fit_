"""aarmy's strict-subset rule for a `--schema` document, re-implemented here.

Source of truth: agents-army-2 `orchestrator/schema.py` (`_first_violation`
and the helpers around it). The real backend refuses to load a schema outside
codex's structured-outputs dialect, with a `SchemaLoadError` before any turn
runs; the fake `aarmy` beside this file applies the same rule so a lax schema
fails the suite instead of the next real run, and `tests/test_strict_schema.py`
runs it over every document in `fitflow/schemas/`.

This is a deliberate duplicate of ~40 lines rather than an import: the driver
does not depend on agents-army-2's package, and the tests must not either.
Keep it in step with that file when the real rule moves.
"""

from collections.abc import Iterator

# Keywords codex refuses outright. `anyOf` is deliberately absent: measured
# accepted, and rejecting it would break parity in the other direction.
FORBIDDEN_KEYWORDS = ("oneOf", "allOf", "not")

# How the root of the document is named in a rejection message, so a message
# reads like the codex error it stands in for.
ROOT_PATH = "$"

PARITY_NOTE = "codex rejects it; one schema has to mean the same thing on every backend"


def _declared_types(node: dict) -> list[object]:
    declared = node.get("type")
    return declared if isinstance(declared, list) else [declared]


def _is_object_node(node: dict) -> bool:
    """`properties` alone counts: a node that lists properties but omits
    `type` is the shape codex rejects just the same."""
    return "object" in _declared_types(node) or "properties" in node


def _rule_broken(node: dict, where: str) -> str | None:
    """The first rule `node` itself breaks, or None. Children are not looked at."""
    for keyword in FORBIDDEN_KEYWORDS:
        if keyword in node:
            return f'{where} uses "{keyword}", which is not supported ({PARITY_NOTE})'
    if not _is_object_node(node):
        return None
    if node.get("additionalProperties") is not False:
        return f'{where} must set "additionalProperties": false ({PARITY_NOTE})'
    required = node.get("required", [])
    missing = [name for name in node.get("properties", {}) if name not in required]
    if missing:
        listed = ", ".join(f"'{name}'" for name in missing)
        return f'{where} must list every property in "required"; missing {listed} ({PARITY_NOTE})'
    return None


def _children(node: dict, where: str) -> Iterator[tuple[object, str]]:
    for name, child in node.get("properties", {}).items():
        yield child, f"{where}.properties.{name}"
    if "items" in node:
        yield node["items"], f"{where}.items"
    for index, branch in enumerate(node.get("anyOf", [])):
        yield branch, f"{where}.anyOf[{index}]"
    for name, child in node.get("$defs", {}).items():
        yield child, f"{where}.$defs.{name}"


def first_violation(node: object, where: str = ROOT_PATH) -> str | None:
    """Depth-first, document order, so the message names one stable node."""
    if not isinstance(node, dict):
        # A boolean child schema is legal and has no rules to break.
        return None
    broken = _rule_broken(node, where)
    if broken is not None:
        return broken
    for child, child_where in _children(node, where):
        broken = first_violation(child, child_where)
        if broken is not None:
            return broken
    return None
