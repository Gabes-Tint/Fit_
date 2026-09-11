"""Box: report - comment on the story summarising the slices and branches."""

from fitflow import github, narrate
from fitflow.github import Story
from fitflow.steps.slicing import Slice


def report_planned(story: Story, slices: list[Slice]) -> None:
    parts = ", ".join(f"#{piece.number} {piece.layer}" for piece in slices)
    github.comment(story.number, f"Planned: {parts}. Next: block 2, delegate.")
    narrate.line(f"🏁 Planned #{story.number} → {parts} · next: block 2, delegate")
