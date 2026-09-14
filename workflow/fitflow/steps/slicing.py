"""Box: spans domain and UI? UI is frontend/interface work; domain is every
non-UI change, including backend and database work. The driver enforces the
binary contract itself rather than trusting the reply: not spanning means
exactly one slice, spanning means exactly two, domain then UI, never a third.

Two rules about the briefs are enforced here too, because a brief that
contradicts its own layer can only be repaired by the planner that wrote it
(#422 proved the alternative: a domain brief that said "Update existing
callers so the app still compiles" about callers under `src/routes/`, and a
solver that could neither obey it nor compile without it).

- No slice is briefed to edit files outside its layer. A brief that names a
  forbidden area, or tells a domain slice to follow its change into its
  callers, goes back to the same planner session with the contradiction
  named, in a bounded loop like block 2's.
- A domain slice whose changed exports the UI calls (`ui_called_exports`)
  stays additive: the driver appends the additive clause to its brief, and
  the ui slice of the same story becomes dependent and carries the
  adopt-and-clean clause. Both clauses are rendered in `fitflow.layers`,
  from the constants the scope check reads.

Once the plan is accepted and any child issues exist, this box creates the
run's retained record (fitflow.runstate.create_run), before any writer
starts: from here on a stopped run is resumed, never replanned, and a fresh
run on the story stops with RUN_STATE_CONFLICT.
"""

from fitflow import agents, audit, github, layers, narrate, planner, runstate, settings, worktrees
from fitflow.github import Story
from fitflow.outcome import FlowFailure, Outcome
from fitflow.slice import Slice

_MAX_PLANNER_ATTEMPTS = 3


def slice_at_layer_boundary(story: Story, issue_context: str) -> list[Slice]:
    spans, raw_slices = _planned(story, issue_context)
    _apply_clauses(raw_slices)
    detail = f"✂️ yes, split into {len(raw_slices)}" if spans else "no"
    narrate.line(f"🔀 Spans domain and UI? → {detail}")
    slices = _split(story, raw_slices) if spans else [_keep_as_is(story, raw_slices[0])]
    runstate.create_run(story.number, worktrees.remote_head("main") or "", agents.roster(), slices)
    return slices


def _planned(story: Story, issue_context: str) -> tuple[bool, list[dict]]:
    """One bounded planner loop: an initial slicing turn plus at most two
    corrective retries in the same planner session. Only a brief that
    contradicts its own layer is retryable - the slice contract (how many
    slices, in what order) is a hard stop as it always was, because no
    rewording repairs a third slice."""
    team = planner.ensure(story.number)
    diagnostic = ""
    for attempt in range(1, _MAX_PLANNER_ATTEMPTS + 1):
        reply, _session = agents.talk(
            team,
            "planner",
            "slices" if attempt == 1 else "slices_correct",
            "slices",
            attribute_failures_to=story.number,
            story_number=story.number,
            story_title=story.title,
            story_body=story.body or "(no body)",
            issue_context=issue_context,
            diagnostic=diagnostic,
        )
        spans, raw_slices = reply["spans_domain_and_ui"], reply["slices"]
        _render(raw_slices)
        _check_contract(spans, raw_slices, story.number)
        diagnostic = _contradiction(raw_slices) or ""
        if not diagnostic:
            return spans, raw_slices
        _narrate_rejection(story.number, diagnostic, attempt)
    raise FlowFailure(
        Outcome.PLAN_REJECTED,
        f"the planner's briefs kept contradicting their own layers for #{story.number} "
        f"after {_MAX_PLANNER_ATTEMPTS} attempts: {diagnostic}; a revised plan in a new "
        "run is required",
        story.number,
        add_blocked=True,
    )


def _narrate_rejection(story_number: int, diagnostic: str, attempt: int) -> None:
    if attempt == _MAX_PLANNER_ATTEMPTS:
        narrate.line(f"🛑 Planner exhausted {_MAX_PLANNER_ATTEMPTS} attempts — {diagnostic}")
        return
    narrate.line(
        f"🔁 Brief sent back to the same planner session after attempt {attempt}: {diagnostic}"
    )


def _contradiction(raw_slices: list[dict]) -> str | None:
    """Why one of these briefs tells its slice to do what its layer
    forbids, or None when none of them does."""
    adopts = _adopting_layer(raw_slices)
    for raw in raw_slices:
        layer = raw["layer"]
        misplaced = _misplaced_exports(raw)
        if misplaced is not None:
            return misplaced
        why = layers.brief_contradiction(layer, raw["brief"], layer == adopts)
        if why is not None:
            return why
    return None


def _misplaced_exports(raw: dict) -> str | None:
    if raw["layer"] == "domain" or not _exports(raw):
        return None
    return (
        f"the {raw['layer']} slice lists ui_called_exports; only a domain slice changes "
        "exports the UI calls, and every other slice sends an empty array"
    )


def _adopting_layer(raw_slices: list[dict]) -> str:
    """ "ui" when this story's domain slice stays additive and its ui slice
    therefore adopts the new API, and "" when no slice adopts anything."""
    domain = [raw for raw in raw_slices if raw["layer"] == "domain"]
    others = [raw for raw in raw_slices if raw["layer"] == "ui"]
    if domain and others and _exports(domain[0]):
        return "ui"
    return ""


def _exports(raw: dict) -> list[str]:
    return [name for name in raw.get("ui_called_exports", []) if name]


def _apply_clauses(raw_slices: list[dict]) -> None:
    """The driver's own words, appended to the briefs the planner wrote, so
    the additive rule cannot be paraphrased away between the reply and the
    issue body block 1 and block 3 both read."""
    adopts = _adopting_layer(raw_slices)
    for raw in raw_slices:
        if raw["layer"] == "domain" and _exports(raw):
            names = _exports(raw)
            raw["brief"] = f"{raw['brief'].rstrip()}\n\n{layers.additive_clause(names)}"
            narrate.line(
                f"🧩 Domain slice stays additive: {', '.join(names)} are called from the UI"
            )
        elif raw["layer"] == adopts:
            raw["brief"] = f"{raw['brief'].rstrip()}\n\n{layers.adopt_clause()}"
            narrate.line("⛓️ UI slice adopts the new API and removes the old shape")


def _render(raw_slices: list[dict]) -> None:
    for index, raw in enumerate(raw_slices, start=1):
        narrate.line(f"   │ Slice {index}:")
        narrate.fields(
            [
                ("Layer", raw.get("layer", "")),
                ("Title", raw.get("title", "")),
                ("Brief", raw.get("brief", "")),
                ("Test kind", raw.get("test_kind", "")),
            ]
        )
        for item in raw.get("acceptance", []):
            narrate.line(f"   │   - {item}")


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
    body = f"Split into: {children}."
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    return slices


def _create_child(story: Story, raw: dict) -> Slice:
    title = f"{story.title} — {raw['layer']}"
    body = f"{_brief_body(raw)}\n\nPart of #{story.number}"
    number = github.create_issue(title, body, [settings.STORY_LABEL, settings.IN_PROGRESS_LABEL])
    audit.child_created(number, raw["layer"])
    narrate.line(
        f'✏️  Created #{number} "{title}" ({settings.STORY_LABEL}, {settings.IN_PROGRESS_LABEL})'
    )
    return _slice_from(number, raw)


def _keep_as_is(story: Story, raw: dict) -> Slice:
    body = _brief_body(raw)
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    return _slice_from(story.number, raw)


def _brief_body(raw: dict) -> str:
    acceptance = "\n".join(f"- {item}" for item in raw["acceptance"])
    return f"{raw['brief']}\n\nAcceptance:\n{acceptance}"


def _slice_from(number: int, raw: dict) -> Slice:
    return Slice(
        number,
        raw["layer"],
        raw["title"],
        raw["brief"],
        list(raw["acceptance"]),
        raw["test_kind"],
        ui_called_exports=_exports(raw),
    )
