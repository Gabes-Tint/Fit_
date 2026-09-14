"""The "outside your layer" heading reads the same widening the scope
check does.

#442 gathers the gate culprits a slice's layer forbids under one heading so
an implementer is not blamed for a file it may not touch. The dependent ui
slice of an additive story may touch the store and the domain modules - it
was briefed to adopt the new API at those call sites - so heading them as
off-limits would put the two instructions back into the contradiction
#422 stopped on, one turn apart.
"""

from fitflow.gates import GateFailure
from fitflow.runstate import SliceRecord
from fitflow.steps.implement import _outside_this_layer

STORE = "src/lib/state/tend.svelte.ts"


def _piece(layer: str, depends_on: str = "") -> SliceRecord:
    return SliceRecord(
        number=1,
        layer=layer,
        title="Tend by index",
        slug=f"story-1-{layer}",
        branch=f"story-1-{layer}",
        team=f"story-1-{layer}",
        worktree="/tmp/story-1",
        brief="b",
        acceptance=["a"],
        test_kind="vitest" if layer == "domain" else "playwright",
        test_files=["src/lib/tend.spec.ts"],
        failing_sha="0" * 40,
        depends_on=depends_on,
    )


def _failure() -> GateFailure:
    return GateFailure(
        diagnostic=f"{STORE}(4,7): error TS2554: Expected 2 arguments, but got 1.",
        culprits=frozenset({STORE}),
        located=True,
    )


def test_the_store_is_not_off_limits_to_the_ui_slice_that_adopts_its_domain_sibling():
    assert _outside_this_layer(_piece("ui", depends_on="domain"), _failure()) == ""


def test_the_store_is_still_off_limits_to_an_independent_ui_slice():
    heading = _outside_this_layer(_piece("ui"), _failure())
    assert "these files are outside your layer (ui) - do not edit them" in heading
    assert "Expected 2 arguments" in heading


def test_a_ui_file_is_still_off_limits_to_a_domain_slice():
    component = "src/lib/components/exercise/SessionExercise.svelte"
    failure = GateFailure(
        diagnostic=f"{component}(9,3): error TS2339: Property 'toggleSet' does not exist.",
        culprits=frozenset({component}),
        located=True,
    )
    assert "outside your layer (domain)" in _outside_this_layer(_piece("domain"), failure)
