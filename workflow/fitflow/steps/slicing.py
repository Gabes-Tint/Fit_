"""Box: spans domain and UI? Second planner turn, same session, schema
slices.json. The driver enforces the contract itself rather than trusting
the reply: not spanning means exactly one slice, spanning means exactly two,
domain then ui.
"""

from dataclasses import dataclass

from fitflow import agents, github, narrate, planner, settings
from fitflow.github import Story
from fitflow.outcome import FlowFailure, Outcome


@dataclass
class Slice:
    number: int
    layer: str
    title: str
    brief: str
    acceptance: list[str]
    test_kind: str


def slice_at_layer_boundary(story: Story) -> list[Slice]:
    team = planner.ensure(story.number)
    reply = agents.talk(
        team,
        "planner",
        "slices",
        "slices",
        attribute_failures_to=story.number,
        story_number=story.number,
        story_title=story.title,
        story_body=story.body or "(no body)",
    )
    spans = reply["spans_domain_and_ui"]
    raw_slices = reply["slices"]
    _check_contract(spans, raw_slices, story.number)
    detail = f"✂️ yes, split into {len(raw_slices)}" if spans else "no"
    narrate.line(f"🔀 Spans domain and UI? → {detail}")
    if spans:
        return _split(story, raw_slices)
    return [_keep_as_is(story, raw_slices[0])]


def _check_contract(spans: bool, raw_slices: list[dict], story_number: int) -> None:
    if not spans and len(raw_slices) != 1:
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"not spanning but got {len(raw_slices)} slices",
            story_number,
        )
    if spans and len(raw_slices) != 2:
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"spanning but got {len(raw_slices)} slices",
            story_number,
        )
    if spans and [item["layer"] for item in raw_slices] != ["domain", "ui"]:
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            "spanning slices must be ordered domain then ui",
            story_number,
        )


def _split(story: Story, raw_slices: list[dict]) -> list[Slice]:
    slices = [_create_child(story, raw) for raw in raw_slices]
    children = ", ".join(f"#{s.number} ({s.layer})" for s in slices)
    github.comment(story.number, f"Split into: {children}.")
    return slices


def _create_child(story: Story, raw: dict) -> Slice:
    title = f"{story.title} — {raw['layer']}"
    body = f"{_brief_body(raw)}\n\nPart of #{story.number}"
    number = github.create_issue(title, body, [settings.STORY_LABEL, settings.IN_PROGRESS_LABEL])
    narrate.line(
        f'✏️  Created #{number} "{title}" ({settings.STORY_LABEL}, {settings.IN_PROGRESS_LABEL})'
    )
    return _slice_from(number, raw)


def _keep_as_is(story: Story, raw: dict) -> Slice:
    github.comment(story.number, _brief_body(raw))
    return _slice_from(story.number, raw)


def _brief_body(raw: dict) -> str:
    acceptance = "\n".join(f"- {item}" for item in raw["acceptance"])
    return f"{raw['brief']}\n\nAcceptance:\n{acceptance}"


def _slice_from(number: int, raw: dict) -> Slice:
    return Slice(
        number, raw["layer"], raw["title"], raw["brief"], list(raw["acceptance"]), raw["test_kind"]
    )
