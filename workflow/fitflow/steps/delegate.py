"""Box: delegate - choose the capability rung per slice, build the
assignment envelope, and pass the pre-launch barrier.

The planner extracts the nine signals and their evidence in one turn on
its existing team; every decision after that is the driver's: signal
validation, the precedence table, the envelope, and the launch barrier.
No worker starts before every slice's assignment is valid and its
resources verified.
"""

from fitflow import agents, assignment, github, narrate, planner, selection, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord, begin_run, retained_inputs
from fitflow.settings import GABRIEL_LOGIN, NEEDS_GABRIEL_LABEL

_MAX_PLANNER_ATTEMPTS = 3


def run(story, slices: list, issue_context: str, base_sha: str) -> RunRecord:
    """Block 2 for every slice of the story: signals turn, selection,
    envelope, pre-launch barrier. Returns the run record for block 3."""
    record = begin_run(story.number, base_sha, agents.roster(), slices)
    try:
        proposals = _signal_proposals(story, slices, issue_context)
        _decide(record, story, proposals)
        _launch_barrier(record)
        return record
    except FlowFailure as failure:
        with record.transition():
            record.terminal = failure.outcome.name
            record.save()
        raise FlowFailure(failure.outcome, failure.why, story.number, True) from failure
    except Exception as error:
        with record.transition():
            record.terminal = "TOOL_FAILED"
            record.save()
        raise FlowFailure(
            Outcome.TOOL_FAILED, f"delegation failed unexpectedly: {error}", story.number, True
        ) from error


def _slice_briefs(slices: list) -> str:
    parts = []
    for piece in slices:
        acceptance_list = "\n".join(
            f"  - [{index}] {item}" for index, item in enumerate(piece.acceptance)
        )
        parts.append(
            f"Slice {piece.layer} (issue #{piece.number}, branch "
            f"story-{piece.number}-{piece.layer}):\n"
            f"Title: {piece.title}\nBrief: {piece.brief}\n"
            f"Failing acceptance tests written by the driver: {', '.join(piece.test_files)}\n"
            f"Acceptance criteria:\n{acceptance_list}"
        )
    return "\n\n".join(parts)


def _signal_proposals(story, slices: list, issue_context: str) -> list[dict]:
    """One bounded planner validation loop: one initial signals turn plus at
    most two corrective retries in the same planner session. Only a contract
    rejection - a malformed reply the planner can author, format and
    resubmit - is retryable; exhausted retries keep the original
    Plan_REJECTED outcome and its diagnostic."""
    team = planner.ensure(story.number)
    diagnostic = ""
    planner_session = ""
    for attempt in range(1, _MAX_PLANNER_ATTEMPTS + 1):
        prompt_name = "delegate" if attempt == 1 else "delegate_correct"
        reply, session = agents.talk(
            team,
            "planner",
            prompt_name,
            "delegate",
            attribute_failures_to=story.number,
            story_number=story.number,
            story_title=story.title,
            issue_context=issue_context,
            slices=_slice_briefs(slices),
            diagnostic=diagnostic,
        )
        planner_session = _require_planner_session(story.number, planner_session, session, attempt)
        try:
            proposals = _validate_reply(reply, slices, story.number)
        except FlowFailure as rejection:
            if rejection.outcome is not Outcome.PLAN_REJECTED:
                raise
            if attempt == _MAX_PLANNER_ATTEMPTS:
                narrate.line(
                    f"🛑 Planner exhausted {_MAX_PLANNER_ATTEMPTS} attempts — {rejection.why}"
                )
                raise
            diagnostic = rejection.why
            narrate.line(
                f"🔁 Planner sending its diagnostic back to the same session after "
                f"attempt {attempt}: {diagnostic}"
            )
            continue
        for proposal in proposals:
            narrate.line(f"🧭 Signals for {proposal['layer']}:")
            with narrate.grouped():
                narrate.block([f"{name}: {value}" for name, value in proposal["signals"].items()])
        return proposals
    raise AssertionError("unreachable: the loop returns or raises on every attempt")


def _require_planner_session(story_number: int, held: str, session: str, attempt: int) -> str:
    """Continuity is enforced, not only requested: the first turn records the
    session id, every corrective turn must prove it came from the same one,
    and a drifted session ends the run as an external-tool failure instead of
    grading a fresh conversation as a revised plan."""
    if attempt == 1:
        return session
    if session != held:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"planner left its session mid-loop: attempts 1..{attempt - 1} ran in "
            f"{held!r} but corrective attempt {attempt} ran in {session!r}",
            story_number,
            add_blocked=True,
        )
    narrate.line(f"🔁 Retry reusing planner session {session}")
    return held


def _reject(story_number: int, why: str) -> FlowFailure:
    return FlowFailure(
        Outcome.PLAN_REJECTED,
        f"delegation contract rejected for #{story_number}: {why}; "
        "a revised plan in a new run is required",
        story_number,
        add_blocked=True,
    )


def _clarify(story, piece: SliceRecord, why: str) -> None:
    """Selection row 2: no role can decide missing product intent. Hand the
    decision to Gabriel the same way block 1's whose-call does."""
    github.add_label(story.number, NEEDS_GABRIEL_LABEL)
    github.assign(story.number, GABRIEL_LOGIN)
    body = (
        f"Blocked on Gabriel: {piece.layer} slice needs clarification\n\n"
        f"Options:\n- Do nothing\n\nRecommendation: clarify the slice's intent, "
        f"then rerun the flow.\n\nWhy: {why}"
    )
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    narrate.line(f"✏️  #{story.number} labelled {NEEDS_GABRIEL_LABEL}, assigned {GABRIEL_LOGIN}")
    narrate.line(f"🛑 Stop: needs Gabriel (exit 11) — {why}")


_PROPOSAL_KEYS = {"layer", "signals", "evidence", "unresolved", "needs_sibling"}


def _validate_reply(reply: dict, slices: list, story_number: int) -> list[dict]:
    """Driver-side strict check of the planner's delegate reply - the fake
    world and a misbehaving backend can both send extra fields."""
    layers = [piece.layer for piece in slices]
    if not isinstance(reply, dict) or set(reply) != {"slices"}:
        raise _reject(story_number, "reply must have exactly the field slices")
    raw = reply["slices"]
    proposal_layers = [entry.get("layer", "") for entry in raw] if isinstance(raw, list) else []
    if (
        not isinstance(raw, list)
        or sorted(proposal_layers) != sorted(layers)
        or len(raw) != len(layers)
    ):
        raise _reject(story_number, f"slices must be exactly one proposal per layer {layers}")
    by_layer = {piece.layer: piece for piece in slices}
    return [
        _validate_proposal(entry, story_number, len(by_layer[entry["layer"]].acceptance))
        for entry in raw
    ]


def _validate_proposal(entry: dict, story_number: int, acceptance_count: int) -> dict:
    if not isinstance(entry, dict):
        raise _reject(story_number, "each slice proposal must be an object")
    unexpected = sorted(set(entry) - _PROPOSAL_KEYS)
    missing = sorted(_PROPOSAL_KEYS - set(entry))
    if unexpected or missing:
        raise _reject(
            story_number,
            f"slice {entry.get('layer', '?')}: unknown field(s) {', '.join(unexpected)}; "
            f"missing field(s) {', '.join(missing)}; a slice proposal carries exactly "
            "layer, signals, evidence, unresolved, needs_sibling",
        )
    if entry["unresolved"]:
        raise _reject(
            story_number,
            f"unresolved signals for {entry['layer']}: "
            f"{', '.join(entry['unresolved'])} - no role can be chosen from "
            "incomplete input",
        )
    if entry["needs_sibling"]:
        raise _reject(
            story_number,
            f"{entry['layer']} cannot be implemented and validated independently "
            "of its sibling slice; replan the story (a revised plan needs a new run)",
        )
    try:
        signals = selection.validate_signals(entry["signals"], f"{entry['layer']} signals")
        selection.check_contradictions(signals)
    except selection.SelectionError as error:
        raise _reject(story_number, str(error)) from error
    _validate_evidence(entry, story_number, acceptance_count)
    return entry


def _validate_evidence(entry: dict, story_number: int, acceptance_count: int) -> None:
    retained = retained_inputs(story_number, entry["layer"], acceptance_count)
    evidence = entry["evidence"]
    if not isinstance(evidence, list) or not evidence:
        raise _reject(story_number, "evidence must be a non-empty array")
    for item in evidence:
        _validate_evidence_entry(item, retained, story_number)
    covered = {item["signal"] for item in evidence}
    missing = [name for name in selection.SIGNAL_NAMES if name not in covered]
    if missing:
        raise _reject(story_number, f"no evidence for signal(s) {', '.join(missing)}")


def _validate_evidence_entry(item: object, retained, story_number: int) -> None:
    if not isinstance(item, dict) or set(item) != {"signal", "source_ref", "detail"}:
        raise _reject(
            story_number, "each evidence entry must have exactly signal, source_ref, detail"
        )
    for key in ("signal", "source_ref", "detail"):
        if not isinstance(item[key], str) or not item[key].strip():
            raise _reject(story_number, f"evidence {key} must be a non-empty string")
    if item["signal"] not in selection.SIGNAL_NAMES:
        raise _reject(story_number, f"evidence names unknown signal {item['signal']!r}")
    if item["source_ref"] not in retained.resolvable_refs:
        raise _reject(story_number, f"evidence source_ref does not resolve: {item['source_ref']!r}")


def _decide(record: RunRecord, story, proposals: list[dict]) -> None:
    for proposal in proposals:
        piece = record.slices[proposal["layer"]]
        signals = selection.validate_signals(proposal["signals"])
        try:
            decision = selection.select_role(signals)
        except selection.ClarificationError as why:
            _clarify(story, piece, why.why)
            raise FlowFailure(
                Outcome.NEEDS_GABRIEL,
                f"slice {piece.layer} needs clarification: {why.why}",
                story.number,
            ) from why
        except selection.SelectionError as error:
            raise _reject(story.number, str(error)) from error
        envelope = {
            "version": 1,
            "slice_ref": f"run-{story.number}/{piece.layer}",
            "revision": 0,
            "role": decision.role,
            "config": record.config[decision.role],
            "signals": {name: proposal["signals"][name] for name in selection.SIGNAL_NAMES},
            "evidence": proposal["evidence"],
            "reason": decision.reason,
        }
        try:
            assignment.validate_envelope(
                envelope,
                role=decision.role,
                revision=0,
                config=agents.roster_entry(decision.role),
                retained=retained_inputs(story.number, piece.layer, len(piece.acceptance)),
            )
        except assignment.AssignmentError as error:
            raise _reject(story.number, f"assignment rejected: {error}") from error
        piece.role = decision.role
        piece.revision = 0
        piece.attempts = 0
        piece.move("assigned")
        piece.assignments.append(envelope)
        narrate.line(f"🎯 #{piece.number} ({piece.layer}) → {decision.role} · {decision.reason}")
    record.save()


def _launch_barrier(record: RunRecord) -> None:
    """Every assignment and resource is verified before any worker starts.
    Launching no worker on rejection is the point of the barrier."""
    narrate.line("🚦 Pre-launch barrier")
    slugs: set[str] = set()
    for piece in record.ordered():
        with narrate.grouped():
            _verify_slice_resources(piece)
            if not (piece.team and piece.branch == piece.slug):
                raise _barrier_contract(
                    piece, "team or branch identity does not match the retained record"
                )
            if piece.slug in slugs:
                raise _barrier_contract(piece, f"duplicate slice identity {piece.slug}")
            slugs.add(piece.slug)
            narrate.line(
                f"   │ #{piece.number} ({piece.layer}) {piece.assignments[-1]['role']} "
                f"· clean at {piece.failing_sha[:12]} · pushed ✔ · tests ✔"
            )


def _verify_slice_resources(piece: SliceRecord) -> None:
    path = worktrees.slice_worktree_path(piece.slug)
    if not path.exists():
        raise FlowFailure(
            Outcome.PLAN_REJECTED,
            f"launch barrier failed for {piece.slug}: worktree is missing",
            piece.number,
            add_blocked=True,
        )
    if not worktrees.is_clean(path):
        raise _barrier_contract(piece, "worktree is dirty at launch; expected clean")
    _verify_slice_content(piece, path)


def _verify_slice_content(piece: SliceRecord, path) -> None:
    head = worktrees.local_head(path)
    if head != piece.failing_sha:
        raise _barrier_contract(
            piece,
            f"worktree HEAD {head[:7]} is not the recorded failing-test commit {piece.failing_sha}",
        )
    if worktrees.remote_head(piece.slug) != head:
        raise _barrier_contract(piece, f"branch {piece.slug} is not pushed")
    for test_file in piece.test_files:
        if not (path / test_file).exists():
            raise _barrier_contract(
                piece, f"acceptance test {test_file} is missing from the worktree"
            )


def _barrier_contract(piece: SliceRecord, why: str) -> FlowFailure:
    return FlowFailure(
        Outcome.AGENT_BROKE_CONTRACT,
        f"launch barrier failed for {piece.slug}: {why}",
        piece.number,
        add_blocked=True,
    )
