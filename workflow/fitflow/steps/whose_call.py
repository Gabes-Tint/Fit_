"""Box: whose call? One planner turn, schema whose_call.json."""

from dataclasses import dataclass

from fitflow import agents, github, narrate, planner, settings
from fitflow.github import Story

DO_NOTHING = "Do nothing"


@dataclass
class Call:
    is_gabriels: bool
    category: str
    reason: str
    question: str
    options: list[str]
    recommendation: str


def whose_call(story: Story) -> Call:
    team = planner.ensure(story.number)
    reply = agents.talk(
        team,
        "planner",
        "whose_call",
        "whose_call",
        attribute_failures_to=story.number,
        story_number=story.number,
        story_title=story.title,
        story_body=story.body or "(no body)",
        story_labels=", ".join(story.labels) or "(none)",
    )
    narrate.fields(
        [
            ("Owner", reply["owner"]),
            ("Category", reply["category"]),
            ("Reason", reply["reason"]),
        ]
    )
    is_gabriels = reply["owner"] == "gabriel"
    side = "🧑 Gabriel's" if is_gabriels else "🧑‍💻 orchestrator's"
    narrate.line(f"🔀 Whose call? → {side}")
    return Call(
        is_gabriels=is_gabriels,
        category=reply["category"],
        reason=reply["reason"],
        question=reply["question"],
        options=_with_do_nothing(reply["options"]),
        recommendation=reply["recommendation"],
    )


def _with_do_nothing(options: list[str]) -> list[str]:
    if any(option.strip().lower() == DO_NOTHING.lower() for option in options):
        return list(options)
    return [*options, DO_NOTHING]


def hand_to_gabriel(story: Story, call: Call) -> None:
    github.add_label(story.number, settings.NEEDS_GABRIEL_LABEL)
    github.assign(story.number, settings.GABRIEL_LOGIN)
    options_block = "\n".join(f"- {option}" for option in call.options)
    body = (
        f"Blocked on Gabriel: {call.question}\n\n"
        f"Options:\n{options_block}\n\n"
        f"Recommendation: {call.recommendation}"
    )
    github.comment(story.number, body)
    narrate.line(
        f"✏️  #{story.number} labelled {settings.NEEDS_GABRIEL_LABEL}, "
        f"assigned {settings.GABRIEL_LOGIN}"
    )
    narrate.line(f"🛑 Stop: needs Gabriel (exit 11) — {call.reason}")
