"""Validation for the driver-produced assignment envelope (delegation-contract.md,
'Proposed assignment envelope'). All listed fields are required; unknown fields
and null are rejected at every object level. Strings are nonempty. Integers
exclude booleans."""

from dataclasses import dataclass

from fitflow.agent_config import AgentConfig
from fitflow.selection import ROLES, SIGNAL_NAMES, SelectionError, validate_signals

ASSIGNMENT_VERSION = 1
ENVELOPE_KEYS = (
    "version",
    "slice_ref",
    "revision",
    "role",
    "config",
    "signals",
    "evidence",
    "reason",
)
CONFIG_KEYS = ("backend", "model", "effort")
EVIDENCE_KEYS = ("signal", "source_ref", "detail")


class AssignmentError(ValueError):
    pass


@dataclass(frozen=True)
class RetainedInputs:
    slice_ref: str
    resolvable_refs: frozenset[str]


def validate_envelope(
    payload: object,
    *,
    role: str,
    revision: int,
    config: AgentConfig,
    retained: RetainedInputs,
) -> None:
    if not isinstance(payload, dict):
        raise AssignmentError("assignment must be an object")
    _exact_keys(payload, ENVELOPE_KEYS, "assignment", "field")
    _version(payload["version"])
    _revision(payload["revision"], revision)
    _slice_ref(payload["slice_ref"], retained)
    _role(payload["role"], role)
    _config(payload["config"], config)
    _signals(payload["signals"])
    _evidence(payload["evidence"], retained)
    _reason(payload["reason"])


def _exact_keys(payload: dict, expected: tuple[str, ...], where: str, label: str) -> None:
    if any(not isinstance(key, str) for key in payload):
        raise AssignmentError(f"{where}: {label}s must be strings")
    actual = set(payload)
    extra = sorted(actual - set(expected))
    if extra:
        raise AssignmentError(f"{where} has unknown {label} {extra[0]}")
    missing = sorted(set(expected) - actual)
    if missing:
        raise AssignmentError(f"{where} is missing {label} {missing[0]}")


def _version(value: object) -> None:
    if _is_integer(value) and value == ASSIGNMENT_VERSION:
        return
    raise AssignmentError(f"assignment.version must be exactly 1, got {value!r}")


def _revision(value: object, expected: int) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise AssignmentError(f"assignment.revision must be an integer, got {value!r}")
    if not 0 <= value <= 2:
        raise AssignmentError(f"assignment.revision must be between 0 and 2, got {value}")
    if value != expected:
        raise AssignmentError(
            f"assignment.revision does not match the assigned revision {expected}"
        )


def _slice_ref(value: object, retained: RetainedInputs) -> None:
    if not _nonempty(value):
        raise AssignmentError("assignment.slice_ref must be a non-empty string")
    if value != retained.slice_ref:
        raise AssignmentError("assignment.slice_ref does not match the retained slice")


def _role(value: object, expected: str) -> None:
    if not _nonempty(value):
        raise AssignmentError("assignment.role must be a non-empty string")
    if value != expected:
        raise AssignmentError("assignment.role does not match the assigned role")
    if value not in ROLES:
        raise AssignmentError(f"assignment.role must be one of {', '.join(ROLES)}; got {value!r}")


def _config(payload: object, config: AgentConfig) -> None:
    if not isinstance(payload, dict):
        raise AssignmentError("assignment.config must be an object")
    _exact_keys(payload, CONFIG_KEYS, "assignment.config", "key")
    expected = (config.backend, config.model, config.effort)
    for key, wanted in zip(CONFIG_KEYS, expected, strict=True):
        value = payload[key]
        if not _nonempty(value):
            raise AssignmentError(f"assignment.config.{key} must be a non-empty string")
        if value != wanted:
            raise AssignmentError(f"assignment.config.{key} does not match the assigned config")


def _signals(payload: object) -> None:
    try:
        validate_signals(payload, "assignment.signals")
    except SelectionError as error:
        raise AssignmentError(f"assignment signals invalid: {error}") from error


def _evidence(payload: object, retained: RetainedInputs) -> None:
    if not isinstance(payload, list) or not payload:
        raise AssignmentError("assignment.evidence must be a non-empty array")
    covered = set()
    for index, entry in enumerate(payload):
        covered.add(_evidence_entry(entry, index, retained))
    uncovered = [name for name in SIGNAL_NAMES if name not in covered]
    if uncovered:
        raise AssignmentError(f"assignment.evidence has no entry for signal {uncovered[0]}")


def _evidence_entry(entry: object, index: int, retained: RetainedInputs) -> str:
    where = f"assignment.evidence[{index}]"
    if not isinstance(entry, dict):
        raise AssignmentError(f"{where} must be an object")
    _exact_keys(entry, EVIDENCE_KEYS, where, "key")
    for key in EVIDENCE_KEYS:
        if not _nonempty(entry[key]):
            raise AssignmentError(f"{where}.{key} must be a non-empty string")
    signal = entry["signal"]
    if signal not in SIGNAL_NAMES:
        raise AssignmentError(
            f"{where}.signal must be one of {', '.join(SIGNAL_NAMES)}; got {signal!r}"
        )
    source_ref = entry["source_ref"]
    if source_ref not in retained.resolvable_refs:
        raise AssignmentError(
            f"{where}.source_ref does not resolve to retained input: {source_ref}"
        )
    return signal


def _reason(value: object) -> None:
    if not _nonempty(value):
        raise AssignmentError("assignment.reason must be a non-empty string")


def _is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _nonempty(value: object) -> bool:
    return isinstance(value, str) and value.strip() != ""
