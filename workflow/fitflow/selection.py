"""Deterministic role selection for block 2, from structured slice signals.

Implements the selection gate of delegation-contract.md: the driver checks
the precedence rows in order and the first applicable row wins. Diff size
and file count have no input here - uncertainty and decision load alone
determine the rung.

An agent (the planner) may extract the signals and propose their evidence,
but this module is the whole verdict: a role name claimed by an agent is
never the decision.
"""

from dataclasses import dataclass
from typing import cast

SENSITIVE_AREAS = ("auth", "shared_state", "store", "security", "persistence")
TECHNICAL_CHOICES = ("none", "bounded", "open")
ROLES = ("mechanic", "builder", "solver")

SIGNAL_NAMES = (
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

BOOLEAN_SIGNALS = (
    "objective_clear",
    "area_known",
    "pattern_known",
    "procedure_complete",
    "solution_uncertain",
    "cause_uncertain",
    "human_decision",
)


class SelectionError(ValueError):
    """Selection row 1: the signal contract is invalid, incomplete or
    contradictory. Reject the assignment; launch no worker."""


class ClarificationError(Exception):
    """Selection row 2: the slice is missing product intent. No role can
    decide this - the run must stop for clarification instead."""

    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


@dataclass(frozen=True)
class Signals:
    objective_clear: bool
    area_known: bool
    pattern_known: bool
    procedure_complete: bool
    solution_uncertain: bool
    cause_uncertain: bool
    technical_choice: str
    sensitive_areas: tuple[str, ...]
    human_decision: bool


@dataclass(frozen=True)
class Decision:
    role: str
    row: int
    reason: str


def _check_shape(payload: object, expected: tuple[str, ...], where: str, label: str) -> None:
    if not isinstance(payload, dict):
        raise SelectionError(f"{where} must be an object")
    missing = sorted(set(expected) - set(payload))
    extra = sorted(set(payload) - set(expected))
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing {label}: {', '.join(missing)}")
        if extra:
            details.append(f"unknown {label}: {', '.join(extra)}")
        raise SelectionError(f"{where}: {'; '.join(details)}")


def _check_boolean(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise SelectionError(f"{where} must be a boolean, got {value!r}")
    return value


def _check_technical_choice(value: object, where: str) -> str:
    if not isinstance(value, str) or value not in TECHNICAL_CHOICES:
        raise SelectionError(
            f"{where}.technical_choice must be one of {', '.join(TECHNICAL_CHOICES)}; got {value!r}"
        )
    return value


def _check_sensitive_areas(value: object, where: str) -> tuple[str, ...]:
    where = f"{where}.sensitive_areas"
    if not isinstance(value, list) or any(not isinstance(area, str) for area in value):
        raise SelectionError(f"{where} must be an array of strings")
    if len(value) != len(set(value)):
        raise SelectionError(f"{where} must not repeat an area")
    unknown = sorted(set(value) - set(SENSITIVE_AREAS))
    if unknown:
        raise SelectionError(
            f"{where} must only use {', '.join(SENSITIVE_AREAS)}; got unknown {', '.join(unknown)}"
        )
    return tuple(value)


def validate_signals(payload: object, where: str = "signals") -> Signals:
    """Strictly type-check the nine signals. Unknown, missing or wrongly
    typed fields are row-1 rejections, never defaults: omission is not
    `false`."""
    _check_shape(payload, SIGNAL_NAMES, where, "signals")
    checked = cast(dict, payload)
    booleans = {name: _check_boolean(checked[name], f"{where}.{name}") for name in BOOLEAN_SIGNALS}
    return Signals(
        **booleans,
        technical_choice=_check_technical_choice(checked["technical_choice"], where),
        sensitive_areas=_check_sensitive_areas(checked["sensitive_areas"], where),
    )


def check_contradictions(signals: Signals) -> None:
    """Row 1: signal pairs that cannot be true together. Checked during
    proposal validation, so the planner's corrective loop can repair a
    contradiction instead of the run grading it into the wrong rung."""
    if signals.procedure_complete and signals.technical_choice != "none":
        raise SelectionError(
            "contradictory signals: procedure_complete with "
            f"technical_choice={signals.technical_choice!r} - a complete procedure "
            "leaves no relevant implementation choice"
        )
    if signals.solution_uncertain and signals.technical_choice == "bounded":
        raise SelectionError(
            'contradictory signals: solution_uncertain with technical_choice="bounded" - '
            "a bounded choice is ordinary construction within a known pattern, so "
            "choosing the solution requires no investigation beyond applying it"
        )


def _clarification(signals: Signals) -> None:
    missing = []
    if signals.human_decision:
        missing.append("a product decision is still open")
    if not signals.objective_clear:
        missing.append("the objective is not clear")
    if missing:
        raise ClarificationError("; ".join(missing))


def _solver_reasons(signals: Signals) -> list[str]:
    """Every row-3 condition, in the order the contract lists them. An empty
    list means no solver condition applies."""
    conditional = (
        (bool(signals.sensitive_areas), f"sensitive area(s) {', '.join(signals.sensitive_areas)}"),
        (signals.solution_uncertain, "the solution requires investigation"),
        (signals.cause_uncertain, "the cause of a defect is unresolved"),
        (
            signals.technical_choice == "open",
            "an architectural/behavioral choice is unresolved",
        ),
        (not signals.area_known, "no concrete files or directories bound the area"),
        (
            not signals.pattern_known and not signals.procedure_complete,
            "no applicable existing pattern is known and no complete procedure "
            "prescribes the edits",
        ),
    )
    return [reason for applies, reason in conditional if applies]


def select_role(signals: Signals) -> Decision:
    """The precedence table. The first applicable row wins.
    Raises SelectionError on a row-1 contradiction and ClarificationError
    on row 2; otherwise returns the role with the row that decided it."""
    check_contradictions(signals)
    _clarification(signals)
    reasons = _solver_reasons(signals)
    if reasons:
        return Decision("solver", 3, f"Selection row 3: {'; '.join(reasons)}.")
    if signals.procedure_complete:
        return Decision(
            "mechanic",
            4,
            "Selection row 4: clear objective, known area, complete procedure, "
            "no uncertainty and no sensitive area.",
        )
    return Decision(
        "builder",
        5,
        "Selection row 5: ordinary implementation with a clear objective but "
        "real construction decisions remaining.",
    )
