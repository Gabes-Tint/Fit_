"""Unit tests for deterministic role selection (delegation-contract.md,
selection gate): strict signal typing and the precedence rows."""

import pytest

from fitflow.selection import (
    ClarificationError,
    Decision,
    SelectionError,
    Signals,
    select_role,
    validate_signals,
)


def _signals(**overrides) -> Signals:
    base = dict(
        objective_clear=True,
        area_known=True,
        pattern_known=True,
        procedure_complete=True,
        solution_uncertain=False,
        cause_uncertain=False,
        technical_choice="none",
        sensitive_areas=(),
        human_decision=False,
    )
    base.update(overrides)
    return Signals(**base)


# --- validate_signals ---------------------------------------------------------


def test_nine_signals_round_trip():
    payload = {
        "objective_clear": True,
        "area_known": True,
        "pattern_known": True,
        "procedure_complete": True,
        "solution_uncertain": False,
        "cause_uncertain": False,
        "technical_choice": "none",
        "sensitive_areas": [],
        "human_decision": False,
    }

    assert validate_signals(payload) == _signals()


@pytest.mark.parametrize(
    "payload,diagnostic",
    [
        ({}, "missing signals"),
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
            "objective_clear must be a boolean",
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
            "technical_choice must be one of none, bounded, open",
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
                "sensitive_areas": ["auth", "auth"],
                "human_decision": False,
            },
            "sensitive_areas must not repeat an area",
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
                "sensitive_areas": ["payments"],
                "human_decision": False,
            },
            "sensitive_areas must only use auth, shared_state, store, security, persistence",
        ),
        ("mechanic", "must be an object"),
    ],
)
def test_invalid_signal_payloads_are_rejected(payload, diagnostic):
    with pytest.raises(SelectionError) as error:
        validate_signals(payload)

    assert diagnostic in str(error.value)


# --- select_role: precedence rows ---------------------------------------------


def test_complete_procedure_with_no_choice_selects_mechanic_row_4():
    decision = select_role(_signals())

    assert decision == Decision(
        "mechanic",
        4,
        "Selection row 4: clear objective, known area, complete procedure, "
        "no uncertainty and no sensitive area.",
    )


def test_complete_procedure_without_a_known_pattern_selects_mechanic_row_4():
    """Issue #377: a fully prescribed procedure is its own pattern. A claimed
    known-pattern gap cannot force a solution investigation while the same
    signals also claim a complete procedure."""
    decision = select_role(
        _signals(
            pattern_known=False,
            procedure_complete=True,
            solution_uncertain=False,
            technical_choice="none",
        )
    )

    assert decision.role == "mechanic"
    assert decision.row == 4


def test_ordinary_construction_with_bounded_choice_selects_builder_row_5():
    decision = select_role(_signals(procedure_complete=False, technical_choice="bounded"))

    assert decision.role == "builder"
    assert decision.row == 5


def test_incomplete_procedure_with_no_choice_selects_builder_row_5():
    decision = select_role(_signals(procedure_complete=False))

    assert decision.role == "builder"


@pytest.mark.parametrize(
    "overrides",
    [
        {"sensitive_areas": ("auth",)},
        {"solution_uncertain": True},
        {"cause_uncertain": True},
        {"technical_choice": "open", "procedure_complete": False},
        {"area_known": False},
        {"pattern_known": False, "procedure_complete": False},
    ],
)
def test_every_solver_condition_selects_solver_row_3(overrides):
    decision = select_role(_signals(**overrides))

    assert decision.role == "solver"
    assert decision.row == 3


def test_sensitivity_outranks_an_otherwise_mechanical_procedure():
    decision = select_role(_signals(sensitive_areas=("persistence",)))

    assert decision.role == "solver"


def test_known_area_with_uncertain_cause_is_valid_and_selects_solver():
    decision = select_role(_signals(cause_uncertain=True))

    assert decision.role == "solver"


def test_precedence_when_multiple_signals_are_present_solver_conditions_compose():
    decision = select_role(
        _signals(
            solution_uncertain=True,
            technical_choice="open",
            procedure_complete=False,
            sensitive_areas=("store", "security"),
        )
    )

    assert decision.role == "solver"
    assert "solution requires investigation" in decision.reason
    assert "architectural/behavioral choice" in decision.reason
    assert "store, security" in decision.reason


def test_a_complete_procedure_claiming_a_choice_is_a_row_1_contradiction():
    with pytest.raises(SelectionError) as error:
        select_role(_signals(technical_choice="bounded"))

    assert "contradictory signals" in str(error.value)
    assert "technical_choice='bounded'" in str(error.value)

    with pytest.raises(SelectionError):
        select_role(_signals(technical_choice="open"))


def test_uncertainty_about_solution_alone_beats_a_builder_objective():
    """Row order: an uncertain solution never falls through to builder."""
    decision = select_role(_signals(solution_uncertain=True, procedure_complete=False))

    assert decision.role == "solver"


def test_uncertainty_claimed_against_a_bounded_choice_is_a_row_1_contradiction():
    """#383: the narrative said the choice was limited, but the same reply
    claimed the solution needs investigation - a bounded choice is ordinary
    construction within a known pattern, so the pair cannot be graded as a
    solver condition."""
    with pytest.raises(SelectionError) as error:
        select_role(
            _signals(solution_uncertain=True, procedure_complete=False, technical_choice="bounded")
        )

    assert "contradictory signals" in str(error.value)
    assert 'technical_choice="bounded"' in str(error.value)
    assert "no investigation beyond applying it" in str(error.value)


# --- row 2: clarification ------------------------------------------------------


def test_human_decision_stops_for_clarification():
    with pytest.raises(ClarificationError) as error:
        select_role(_signals(human_decision=True))

    assert "a product decision is still open" in error.value.why


def test_unclear_objective_stops_for_clarification():
    with pytest.raises(ClarificationError) as error:
        select_role(_signals(objective_clear=False))

    assert "the objective is not clear" in error.value.why


def test_clarification_outranks_every_capability_row():
    """Even a sensitive solver-shaped slice with a human decision open stops
    for clarification instead of choosing a role."""
    with pytest.raises(ClarificationError):
        select_role(_signals(human_decision=True, sensitive_areas=("auth",), cause_uncertain=True))
