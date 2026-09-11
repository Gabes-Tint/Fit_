"""Box: report - comment on the story summarizing the slices and branches."""

from fitflow import github, narrate
from fitflow.github import Story
from fitflow.slice import Slice


def report_planned(story: Story, slices: list[Slice]) -> None:
    parts = ", ".join(f"#{piece.number} {piece.layer}" for piece in slices)
    body = f"Planned: {parts}. Next: block 2, delegate."
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    narrate.line(f"🏁 Planned #{story.number} → {parts} · next: block 2, delegate")
