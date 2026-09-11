"""Block 1 of docs/development-flow.md: pick and plan.

Read top to bottom: each line is a box or a diamond of the diagram.
The detail lives in fitflow/steps/, one module per box.
"""

from fitflow import steps
from fitflow.cli import run
from fitflow.outcome import Outcome


def pick_and_plan(issue: int | None, spend_flagged: bool) -> Outcome:
    steps.sync()
    story = steps.pick_story(issue)
    if story is None:
        return Outcome.NOTHING_TO_PICK

    call = steps.whose_call(story)
    if call.is_gabriels:
        steps.hand_to_gabriel(story, call)
        return Outcome.NEEDS_GABRIEL

    if spend_flagged:
        steps.pause(story)
        return Outcome.PAUSED

    steps.hold(story)
    slices = steps.slice_at_layer_boundary(story)
    for piece in slices:
        steps.write_failing_tests(piece)

    steps.report_planned(story, slices)
    return Outcome.PLANNED


if __name__ == "__main__":
    run(pick_and_plan)
