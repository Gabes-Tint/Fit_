"""Box: spending flagged? Checked before the story is held, same order as
the diagram."""

from fitflow import github, narrate, settings
from fitflow.github import Story

PAUSE_MESSAGE = "Paused: spending is flagged; filed only."


def pause(story: Story) -> None:
    github.add_label(story.number, settings.PAUSED_LABEL)
    github.comment(story.number, PAUSE_MESSAGE)
    narrate.line("🔀 Spending flagged? → yes, pausing")
    narrate.line(f"✏️  #{story.number} labelled {settings.PAUSED_LABEL}")
    narrate.line("🛑 Stop: paused (exit 12) — spending is flagged")
