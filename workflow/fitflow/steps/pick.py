"""Box: pick - the named issue, or the lowest-numbered open story not held
by in-progress, blocked, needs-gabriel, or paused.
"""

from fitflow import github, narrate, settings
from fitflow.github import Story
from fitflow.outcome import FlowFailure, Outcome


def pick_story(issue: int | None) -> Story | None:
    if issue is not None:
        return _pick_explicit(issue)
    return _pick_lowest()


def _held_by(story: Story) -> set[str]:
    return settings.HOLDING_LABELS & set(story.labels)


def _pick_explicit(issue: int) -> Story:
    story = github.view(issue)
    if story.state != "OPEN":
        raise FlowFailure(Outcome.NOT_PICKABLE, f"#{issue} is {story.state.lower()}")
    if settings.STORY_LABEL not in story.labels:
        raise FlowFailure(
            Outcome.NOT_PICKABLE, f"#{issue} is not labelled '{settings.STORY_LABEL}'"
        )
    held = _held_by(story)
    if held:
        raise FlowFailure(Outcome.NOT_PICKABLE, f"#{issue} is held by {', '.join(sorted(held))}")
    _announce(story)
    return story


def _pick_lowest() -> Story | None:
    stories = github.list_open_stories()
    held = [story for story in stories if _held_by(story)]
    pickable = [story for story in stories if not _held_by(story)]
    detail = ", ".join(f"#{story.number} {sorted(_held_by(story))[0]}" for story in held)
    summary = f"🔎 Pick: {len(stories)} open stories, {len(held)} held"
    narrate.line(f"{summary} ({detail})" if held else summary)
    if not pickable:
        narrate.line("🛑 Stop: nothing to pick (exit 10) — no open story is free to pick")
        return None
    story = pickable[0]
    _announce(story)
    return story


def _announce(story: Story) -> None:
    narrate.line(f'📋 Picked #{story.number} "{story.title}"')
    narrate.line(f"🏷️  Labels: {', '.join(story.labels) or '(none)'}")
