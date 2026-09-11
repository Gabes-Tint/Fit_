"""Box: hold the story - label in-progress before slicing and delegating."""

from fitflow import github, narrate, settings
from fitflow.github import Story


def hold(story: Story) -> None:
    github.add_label(story.number, settings.IN_PROGRESS_LABEL)
    narrate.line(f"✏️  #{story.number} labelled {settings.IN_PROGRESS_LABEL}")
