"""Fit_'s development flow driver, blocks 1-3 of docs/development-flow.md.

Read top to bottom: each line is a box or a diamond of the diagram.
The detail lives in fitflow/steps/, one module per box. Block 1 plans and
writes failing acceptance tests; block 2 selects each slice's capability
rung (mechanic, builder or solver) and passes the pre-launch barrier;
block 3 runs the bounded implementation loops, validates every turn,
corrects, escalates and joins at the final barrier. Delivery (push, PR,
review) is block 4 and not part of this driver yet.
"""

from fitflow import github, issue_context, runstate, steps, worktrees
from fitflow.cli import run
from fitflow.outcome import Outcome


def pick_and_plan(issue: int | None) -> Outcome:
    steps.sync()
    story = steps.pick_story(issue)
    if story is None:
        return Outcome.NOTHING_TO_PICK

    with runstate.story_lock(story.number):
        context = issue_context.prepare(
            github.comments(story.number), github.timeline(story.number)
        )

        call = steps.whose_call(story, context)
        if call.is_for_gabriel:
            steps.hand_to_gabriel(story, call)
            return Outcome.NEEDS_GABRIEL

        steps.hold(story)
        slices = steps.slice_at_layer_boundary(story, context)
        slices = steps.write_failing_tests(slices, story.number)

        steps.report_planned(story, slices)

        record = steps.delegate(story, slices, context, worktrees.remote_head("main") or "")
        return steps.implement(story, record)


if __name__ == "__main__":
    run(pick_and_plan)
