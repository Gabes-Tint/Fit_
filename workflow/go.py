"""Block 1 of docs/development-flow.md: pick and plan.

Read top to bottom: each line is a box or a diamond of the diagram.
The detail lives in fitflow/steps/, one module per box.
"""

from fitflow import github, issue_context, steps
from fitflow.cli import run
from fitflow.outcome import Outcome


def pick_and_plan(issue: int | None) -> Outcome:
    steps.sync()
    story = steps.pick_story(issue)
    if story is None:
        return Outcome.NOTHING_TO_PICK

    context = issue_context.prepare(github.comments(story.number), github.timeline(story.number))

    call = steps.whose_call(story, context)
    if call.is_for_gabriel:
        steps.hand_to_gabriel(story, call)
        return Outcome.NEEDS_GABRIEL

    steps.hold(story)
    slices = steps.slice_at_layer_boundary(story, context)
    steps.write_failing_tests(slices, story.number)

    steps.report_planned(story, slices)
    return Outcome.PLANNED


if __name__ == "__main__":
    run(pick_and_plan)
