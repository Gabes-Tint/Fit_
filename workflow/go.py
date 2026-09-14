"""Fit_'s development flow driver, blocks 1-5 of docs/development-flow.md.

Read top to bottom: each line is a box or a diamond of the diagram.
The detail lives in fitflow/steps/, one module per box. Block 1 plans and
writes failing acceptance tests; block 2 selects each slice's capability
rung (mechanic, builder or solver) and passes the pre-launch barrier;
block 3 runs the bounded implementation loops, validates every turn,
corrects, escalates, sends the acceptance tests back to block 1's writer
when an implementer's verified objection shows they cannot all pass, and
joins at the final barrier; block 4 builds the
integration branch, opens the PR, runs the reviewer unless the change is
mechanical, verifies CI itself and merges; block 5 ships that merge - its
tag, main's own CI, the QA deploy, the flaky decision, production, the
Android release and cleanup.

`--resume` re-enters the same flow at the block a stopped run reached -
block 1's writers included, for slices whose tests were never frozen -
after reconciling its retained record with the worktrees it left;
`--reset` undoes what a run created and archives its record.
"""

from fitflow import github, issue_context, runstate, steps
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

        record = steps.delegate(story, slices, context)
        steps.implement(story, record)
        steps.deliver(story, record)
        return steps.ship(story, record)


def resume(issue: int) -> Outcome:
    steps.sync()
    story = steps.pick_for_resume(issue)

    with runstate.story_lock(story.number):
        record = runstate.load_run(story.number)
        stage = steps.reconcile(story, record)

        if stage == steps.WRITE_TESTS:
            steps.write_failing_tests(
                steps.unfrozen_slices(record), story.number, record, resuming=True
            )
            steps.report_planned(story, record.ordered())
            stage = steps.DELEGATE
        if stage == steps.DELEGATE:
            context = issue_context.prepare(
                github.comments(story.number), github.timeline(story.number)
            )
            steps.redelegate(story, record, context)
            stage = steps.IMPLEMENT
        if stage == steps.IMPLEMENT:
            steps.implement(story, record)
            stage = steps.DELIVER
        if stage == steps.DELIVER:
            steps.deliver(story, record)
        return steps.ship(story, record)


def reset(issue: int) -> Outcome:
    return steps.reset(issue)


if __name__ == "__main__":
    run(pick_and_plan, resume, reset)
