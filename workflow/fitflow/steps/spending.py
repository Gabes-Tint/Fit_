"""Box: spending flagged? Checked before the story is held, same order as
the diagram."""

from fitflow import github, narrate, settings
from fitflow.github import Story

PAUSE_MESSAGE = "Paused: spending is flagged; filed only."


def spending_flagged(flagged: bool) -> bool:
    detail = "yes, pausing" if flagged else "no, carry on"
    narrate.line(f"🔀 Spending flagged? → {detail}")
    return flagged


def pause(story: Story) -> None:
    github.add_label(story.number, settings.PAUSED_LABEL)
    narrate.comment_posted(story.number, PAUSE_MESSAGE)
    github.comment(story.number, PAUSE_MESSAGE)
    narrate.line(f"✏️  #{story.number} labelled {settings.PAUSED_LABEL}")
    narrate.line("🛑 Stop: paused (exit 12) — spending is flagged")
