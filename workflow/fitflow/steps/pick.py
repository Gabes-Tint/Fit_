"""Box: pick - the named issue, or the lowest-numbered open story not held
by in-progress, blocked, needs-gabriel, or paused.

A story that already has a retained run is refused here, before any planner
turn: the record, not the hold its run left, is what the stop names, with
`--resume` and `--reset` as the ways on. A run still holding the story lock
is alive and the record is its own: that story is refused as held, never
marked blocked.
"""

from fitflow import audit, github, narrate, runstate, settings
from fitflow.github import Story
from fitflow.outcome import FlowFailure, Outcome


def pick_story(issue: int | None) -> Story | None:
    if issue is not None:
        return _pick_explicit(issue)
    return _pick_lowest()


def _held_by(story: Story) -> set[str]:
    return settings.HOLDING_LABELS & set(story.labels)


def _pick_explicit(issue: int) -> Story:
    try:
        story = github.view(issue)
    except RuntimeError as error:
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{issue} does not exist: {error}") from error
    if story.state != "OPEN":
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{issue} is {story.state.lower()}")
    if settings.STORY_LABEL not in story.labels:
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{issue} is not labelled '{settings.STORY_LABEL}'")
    _refuse_a_stopped_run(issue)
    held = _held_by(story)
    if held:
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{issue} is held by {', '.join(sorted(held))}")
    _announce(story)
    return story


def _refuse_a_stopped_run(number: int) -> None:
    """A retained record whose run is gone stops a fresh run with
    RUN_STATE_CONFLICT. While a live run holds the story lock the record is
    that run's: the hold check or the lock refuses the second run, without
    labelling the live story `blocked`."""
    if not runstate.story_locked(number):
        runstate.refuse_retained_run(number)


def pick_for_resume(issue: int) -> Story:
    """The story a `--resume` continues: a story, not on a human hold.
    `in-progress` and `blocked` are the run's own marks and do not stop it
    from picking its own story back up. Whether it may be closed is the
    record's to say (a merged PR closes it before block 5 ends), so the
    resume box checks that."""
    try:
        story = github.view(issue)
    except RuntimeError as error:
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{issue} does not exist: {error}") from error
    if settings.STORY_LABEL not in story.labels:
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{issue} is not labelled '{settings.STORY_LABEL}'")
    human = settings.HUMAN_HOLD_LABELS & set(story.labels)
    if human:
        raise FlowFailure(
            Outcome.CANNOT_PICK,
            f"#{issue} is held by {', '.join(sorted(human))}; remove the label to resume",
        )
    _announce(story)
    return story


def _pick_lowest() -> Story | None:
    stories = github.list_open_stories()
    held = [story for story in stories if _held_by(story)]
    free = [story for story in stories if not _held_by(story)]
    detail = ", ".join(f"#{story.number} {sorted(_held_by(story))[0]}" for story in held)
    noun = "open story" if len(stories) == 1 else "open stories"
    summary = f"🔎 Pick: {len(stories)} {noun}, {len(held)} held"
    narrate.line(f"{summary} ({detail})" if held else summary)
    if not free:
        narrate.line("🛑 Stop: nothing to pick (exit 10) — no open story is free to pick")
        return None
    story = free[0]
    narrate.open_for_issue(story.number)
    _refuse_a_stopped_run(story.number)
    _announce(story)
    return story


def _announce(story: Story) -> None:
    audit.picked(story.number)
    narrate.line(f'📋 Picked #{story.number} "{story.title}"')
    narrate.line(f"🏷️  Labels: {', '.join(story.labels) or '(none)'}")
