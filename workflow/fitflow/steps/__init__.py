"""One module per box of the diagram. This is exactly what go.py calls."""

from fitflow.steps.delegate import run as run_delegate
from fitflow.steps.failing_tests import write_failing_tests
from fitflow.steps.hold import hold
from fitflow.steps.implement import run as run_implement
from fitflow.steps.pick import pick_story
from fitflow.steps.report import report_planned
from fitflow.steps.slicing import slice_at_layer_boundary
from fitflow.steps.sync import sync
from fitflow.steps.whose_call import hand_to_gabriel, whose_call

delegate = run_delegate
implement = run_implement

__all__ = [
    "delegate",
    "hand_to_gabriel",
    "hold",
    "implement",
    "pick_story",
    "report_planned",
    "slice_at_layer_boundary",
    "sync",
    "whose_call",
    "write_failing_tests",
]
