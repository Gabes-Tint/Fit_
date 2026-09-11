"""Box: whose call? One planner turn, schema whose_call.json."""

from dataclasses import dataclass

from fitflow import agents, github, narrate, settings, teams
from fitflow.github import Story

DO_NOTHING = "Do nothing"


@dataclass
class Call:
    is_for_gabriel: bool
    category: str
    reason: str
    question: str
    options: list[str]
    recommendation: str


def whose_call(story: Story) -> Call:
    team = teams.for_issue(story.number)
    reply = agents.talk(
        team.name,
        "planner",
        "whose_call",
        "whose_call",
        attribute_failures_to=story.number,
        story_number=story.number,
        story_title=story.title,
        story_body=story.body or "(no body)",
        story_labels=", ".join(story.labels) or "(none)",
    )
    teams.verify_left_clean(team, story.number)
    narrate.fields(
        [
            ("Owner", reply["owner"]),
            ("Category", reply["category"]),
            ("Reason", reply["reason"]),
            ("Question", reply["question"]),
            ("Options", ", ".join(reply["options"]) or "(none)"),
            ("Recommendation", reply["recommendation"]),
        ]
    )
    is_for_gabriel = reply["owner"] == "gabriel"
    side = "🧑 Gabriel's" if is_for_gabriel else "🧑‍💻 orchestrator's"
    narrate.line(f"🔀 Whose call? → {side}")
    return Call(
        is_for_gabriel=is_for_gabriel,
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
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    narrate.line(
        f"✏️  #{story.number} labelled {settings.NEEDS_GABRIEL_LABEL}, "
        f"assigned {settings.GABRIEL_LOGIN}"
    )
    narrate.line(f"🛑 Stop: needs Gabriel (exit 11) — {call.reason}")
