"""Box: implement and validate - one bounded level loop per slice.

Each slice gets one initial implementation turn plus at most two
corrections in the same role, session and worktree. A repairable failure
at attempt 3 escalates exactly one rung (mechanic → builder → solver) with
a new assignment revision, a new identity and reset attempts, reusing the
same issue, team, branch, worktree and accumulated implementation. An
exhausted solver stops the run and preserves everything. External and
contract failures stop immediately without consuming a correction.

Two slices run their loops in parallel; a succeeded slice is frozen -
committed by the driver, never rerun while its sibling corrects or
escalates - and the join releases only when every slice is succeeded with
its frozen commit unchanged.
"""

from concurrent.futures import ThreadPoolExecutor
from pathlib import PurePosixPath

from fitflow import (
    acceptance,
    agents,
    assignment,
    failure_reason,
    gates,
    github,
    layers,
    narrate,
    runstate,
    turns,
    worktrees,
)
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord, retained_inputs

_SUCCESSOR = {"mechanic": "builder", "builder": "solver"}
# The gates the agent is judged by: the quality scripts, the CI workflows
# and the repository's own scripts stay out of reach of an implementation
# turn. `workflow/` is deliberately absent - an agent may implement changes
# to the driver itself (it edits a worktree copy; the running driver is the
# main checkout's code, and the driver's own suite runs in CI's "Workflow
# driver" job, not in this block's validation). What the driver never does
# is merge such a change: block 4 hands that pull request to Gabriel.
_FORBIDDEN_PREFIXES = ("quality/", ".github/", "scripts/")
_FORBIDDEN_FILES = {
    "agents.yaml",
    "bun.lock",
    "cspell.json",
    "eslint.config.js",
    "knip.json",
    "package-lock.json",
    "package.json",
    "playwright.config.ts",
    "pnpm-lock.yaml",
    "prettier.config.js",
    "prettier.config.mjs",
    "prettier.config.ts",
    "svelte.config.js",
    "stryker.config.mjs",
    "tsconfig.json",
    "vite.config.ts",
    "vitest.config.ts",
    ".tool-versions",
}
_UI_ONLY_PREFIXES = ("src/routes/", "src/lib/components/", "src/lib/ui/")


def run(story, record: RunRecord) -> Outcome:
    """Block 3 for every slice, in parallel when there are two; then the
    final barrier, the final report, and the terminal record. Raises the
    first failure in domain-then-ui order. IMPLEMENTED is persisted only
    after the GitHub comment succeeds."""
    _run_block3(record)
    _report_gate(story, record, "reporting")
    _persist_terminal(record, "IMPLEMENTED")
    return Outcome.IMPLEMENTED


def _run_block3(record: RunRecord) -> None:
    """The parallel loops and the final barrier. A tile that dies off the
    beaten path is named honestly: this phase has not reported anywhere."""
    try:
        # a resumed run brings frozen slices along: they are never rerun,
        # only re-verified at the join
        _run_loops(record, [piece for piece in record.ordered() if piece.state != "succeeded"])
        _verify_frozen(record)
    except FlowFailure as failure:
        _persist_terminal(record, failure.outcome.name)
        raise FlowFailure(failure.outcome, failure.why, record.story_number, True) from failure
    except Exception as error:
        _persist_terminal(record, "TOOL_FAILED")
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"implementation failed unexpectedly while implementing: {_describe(error)}",
            record.story_number,
            True,
        ) from error


def _run_loops(record: RunRecord, pieces: list[SliceRecord]) -> None:
    if len(pieces) == 1:
        _run_slice(record, pieces[0])
        return
    if not pieces:
        return
    narrate.line(f"⚡ Starting {len(pieces)} implementation loops in parallel")
    failures = _run_parallel(record, pieces)
    narrate.line(f"⏳ Implementation barrier: all {len(pieces)} slices settled")
    if failures:
        for piece, failure in failures:
            narrate.line(f"❌ #{piece.number} ({piece.layer}): {_describe(failure)}")
        raise failures[0][1]


def _report_gate(story, record: RunRecord, stage: str) -> None:
    try:
        _report(story, record)
    except FlowFailure as failure:
        _persist_terminal(record, failure.outcome.name)
        raise FlowFailure(failure.outcome, failure.why, record.story_number, True) from failure
    except Exception as error:
        _persist_terminal(record, "TOOL_FAILED")
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"implementation succeeded locally but the run failed while {stage}: "
            f"{_describe(error)}",
            record.story_number,
            True,
        ) from error


def _persist_terminal(record: RunRecord, terminal: str) -> None:
    """The persisted record must name a terminal outcome even when the flow
    died off the beaten path. An interrupted process still leaves it empty:
    that is the one state that honestly means 'uncertain'."""
    with record.transition():
        record.terminal = terminal
        record.save()


def _describe(failure: Exception) -> str:
    if isinstance(failure, FlowFailure):
        return f"{failure.outcome.name} — {failure.why}"
    return f"{type(failure).__name__} — {failure}"


def _run_parallel(
    record: RunRecord, pieces: list[SliceRecord]
) -> list[tuple[SliceRecord, Exception]]:
    with ThreadPoolExecutor(max_workers=len(pieces), thread_name_prefix="fit-implement") as pool:
        futures = [(piece, pool.submit(_run_slice, record, piece)) for piece in pieces]
        failures = []
        for piece, future in futures:
            try:
                future.result()
            except Exception as error:  # collected in deterministic slice order after the barrier
                failures.append((piece, error))
        return failures


def _run_slice(record: RunRecord, piece: SliceRecord) -> None:
    """One slice's level loop: assigned → running → validating →
    (correcting → running | escalating → assigned | succeeded | failed).
    Every unlisted transition is prohibited.

    A resumed slice may arrive "running" with its last turn already
    completed: that turn's verdict is pending, and it is re-derived from
    the reply and worktree the turn left - no new agent call."""
    if piece.state == "running":
        last = piece.turns[-1]
        narrate.line(
            f"♻️  #{piece.number} ({piece.layer}) re-validating {piece.role} attempt "
            f"{last['attempt']} from its retained reply, without a new agent call"
        )
        if _settle(record, piece, last["reply"], piece.attempts):
            return
    while True:
        _pre_turn_barrier(record, piece)
        with record.transition():
            piece.attempts += 1
            attempt = piece.attempts
            piece.move("running")
            record.save()
        prompt_name = "implement" if attempt == 1 else "correct_implementation"
        narrate_turn_start(piece, attempt)
        identity = record.begin_turn(piece, piece.role, attempt, prompt_name)
        reply, session = _launch_turn(record, piece, identity, prompt_name, attempt)
        with record.transition():
            digest = worktrees.working_tree_digest(worktrees.slice_worktree_path(piece.slug))
            record.end_turn(piece, identity, "ok", reply["summary"], session, reply, digest)
        if _settle(record, piece, reply, attempt):
            return


def _settle(record: RunRecord, piece: SliceRecord, reply: dict, attempt: int) -> bool:
    """Judge one completed turn. True once the slice is frozen; False when
    the loop must launch again (a correction, or the escalated role's first
    attempt); raises when the run stops."""
    try:
        diagnostic = _validate_turn(record, piece, reply)
    except FlowFailure as failure:
        # a contract violation or external tool failure during
        # validation still settles the stop: the slice lands in
        # "failed" instead of being left in an active state, and the
        # settled turn's verdict becomes the diagnostic, not a green
        with record.transition():
            piece.move("failed")
            piece.turns[-1]["result"] = "failed"
            piece.turns[-1]["why"] = failure.why
            record.save()
        raise
    if diagnostic is None:
        _freeze(record, piece)
        return True
    with record.transition():
        piece.diagnostics.append(diagnostic)
    narrate.line(f"🩺 #{piece.number} ({piece.layer}) diagnostic: {diagnostic}")
    if attempt < turns.BUDGET:
        with record.transition():
            piece.move("correcting")
            record.save()
        narrate.line(
            f"🔁 {piece.role.capitalize()} #{piece.number} ({piece.layer}) "
            f"correcting after attempt {attempt}"
        )
        return False
    _escalate_or_stop(record, piece, diagnostic)
    return False


def narrate_turn_start(piece: SliceRecord, attempt: int) -> None:
    with narrate.grouped():
        narrate.line(
            f"🔧 {piece.role.capitalize()} #{piece.number} ({piece.layer}) "
            f"attempt {attempt}/{turns.BUDGET}"
        )


def _launch_turn(
    record: RunRecord, piece: SliceRecord, identity: dict, prompt_name: str, attempt: int
) -> tuple[dict, str]:
    """Run the agent turn and admit only a structurally valid reply in the
    recorded session. A failed talk or a contract-violating reply still
    settles its turn: failed, with the printed session, and the audit shows a
    finished rejected turn instead of one left running."""
    try:
        reply, session = _talk(piece, prompt_name, attempt)
    except FlowFailure as failure:
        with record.transition():
            record.end_turn(piece, identity, "failed", failure.why)
            piece.move("failed")
            record.save()
        raise _blocked(failure) from failure
    try:
        _check_session(record, piece, session)
        # the reply's structure is validated before anything is settled
        # from it: a non-object reply is a contract failure, never an
        # attribute error on the way to the ledger
        _check_reply_structure(record, piece, reply)
    except FlowFailure as failure:
        with record.transition():
            record.end_turn(piece, identity, "failed", failure.why, session)
            piece.move("failed")
            record.save()
        raise _blocked(failure) from failure
    return reply, session


def _blocked(failure: FlowFailure) -> FlowFailure:
    return FlowFailure(failure.outcome, failure.why, failure.story_number, add_blocked=True)


def _pre_turn_barrier(record: RunRecord, piece: SliceRecord) -> None:
    """Before every turn: exclusive ownership, unchanged configuration, the
    current assignment revision, the expected branch and worktree, the
    previous turn's settled result, and the AI Army team still owning
    exactly this slice's worktree."""
    runstate.verify_exclusive(record.story_number)
    runstate.verify_team_ownership(piece)
    _check_assignment(record, piece)
    path = worktrees.slice_worktree_path(piece.slug)
    _check_worktree_before_turn(record, piece, path)
    _check_previous_turn_settled(record, piece, path)


def _check_session(record: RunRecord, piece: SliceRecord, session: str) -> None:
    """The session id the CLI printed is the only continuity evidence:
    a correction must come from the same session the role recorded, and an
    escalated role must establish a new session identity. A changed,
    missing or reused session id is a contract failure."""
    # a turn that failed before the CLI printed a session (a launch error)
    # is no evidence either way; a voided turn that did print one still is
    completed = [
        entry for entry in piece.turns if entry["status"] == "completed" and entry.get("session")
    ]
    same_role = [entry for entry in completed if entry["role"] == piece.role]
    if same_role and same_role[-1].get("session") != session:
        raise _contract(
            record,
            piece,
            f"session changed mid-role: turn {same_role[-1]['attempt']} ran in "
            f"{same_role[-1].get('session')!r}, this turn in {session!r}",
        )
    if piece.revision > 0 and not same_role:
        other_roles = [entry for entry in completed if entry["role"] != piece.role]
        if other_roles and other_roles[-1].get("session") == session:
            raise _contract(
                record,
                piece,
                f"escalated role {piece.role} reused the previous role's session {session!r}",
            )


def _check_assignment(record: RunRecord, piece: SliceRecord) -> None:
    assignment_record = piece.assignments[-1]
    if assignment_record["role"] != piece.role or assignment_record["revision"] != piece.revision:
        raise _contract(record, piece, "assignment does not match the slice's role/revision")
    if record.config[piece.role] != assignment_record["config"]:
        raise _contract(record, piece, "configuration changed since the assignment was accepted")
    if any(entry["status"] == "running" for entry in piece.turns):
        raise _contract(record, piece, "the previous turn never settled")


def _check_worktree_before_turn(record: RunRecord, piece: SliceRecord, path) -> None:
    if not path.exists():
        raise _contract(record, piece, "worktree is missing before the turn")
    if worktrees.current_branch(path) != piece.branch:
        raise _contract(record, piece, f"worktree is not on branch {piece.branch}")


def _check_previous_turn_settled(record: RunRecord, piece: SliceRecord, path) -> None:
    # a relaunch of a voided first attempt (see steps/resume.py) starts on
    # whatever the dead turn left: that is accumulated work, not dirt
    if not piece.turns and not worktrees.is_clean(path):
        raise _contract(record, piece, "the initial launch must start from a clean worktree")


def _talk(piece: SliceRecord, prompt_name: str, attempt: int) -> tuple[dict, str]:
    return agents.talk(
        piece.team,
        piece.role,
        prompt_name,
        "implementation",
        attribute_failures_to=piece.number,
        role_name=piece.role,
        role_capitalized=piece.role.capitalize(),
        slice_number=piece.number,
        slice_title=piece.title,
        branch=piece.branch,
        test_kind=piece.test_kind,
        brief=piece.brief,
        acceptance="\n".join(f"- {item}" for item in piece.acceptance),
        test_files="\n".join(piece.test_files),
        attempt=str(attempt),
        diagnostic=piece.diagnostics[-1] if piece.diagnostics else "",
        prior_diagnostics="\n".join(f"- {item}" for item in piece.diagnostics) or "(none)",
    )


def review_fix_turn(record: RunRecord, piece: SliceRecord, diagnostic: str) -> None:
    """One block 4 fix turn: the review findings as the diagnostic, the same
    role, session and worktree, then the full block 3 validation and a new
    driver-made freeze commit. This is the one sanctioned exit from
    `succeeded`; the turn is recorded with kind `review_fix` and does not
    consume block 3's attempt budget - the review loop has its own."""
    _pre_turn_barrier(record, piece)
    with record.transition():
        piece.move("fixing")
        piece.diagnostics.append(diagnostic)
        piece.attempts += 1
        attempt = piece.attempts
        identity = record.begin_turn(piece, piece.role, attempt, "review_fix")
        record.save()
    narrate.line(f"🔧 {piece.role.capitalize()} #{piece.number} ({piece.layer}) review fix")
    reply, session = _launch_turn(record, piece, identity, "correct_implementation", attempt)
    with record.transition():
        record.end_turn(piece, identity, "ok", reply["summary"], session)
    try:
        failure = _validate_turn(record, piece, reply, frozen_ok=True)
    except FlowFailure as failure:
        with record.transition():
            piece.move("failed")
            piece.turns[-1]["result"] = "failed"
            piece.turns[-1]["why"] = failure.why
            record.save()
        raise
    if failure is not None:
        with record.transition():
            piece.move("failed")
            piece.turns[-1]["result"] = "failed"
            piece.turns[-1]["why"] = failure
            record.save()
        raise FlowFailure(
            Outcome.CAPACITY_EXHAUSTED,
            f"{piece.slug}: the review fix turn failed validation: {failure}",
            record.story_number,
            add_blocked=True,
        )
    _freeze(record, piece)


def _escalate_or_stop(record: RunRecord, piece: SliceRecord, diagnostic: str) -> None:
    if piece.role == "solver":
        with record.transition():
            piece.move("failed")
            record.save()
        raise FlowFailure(
            Outcome.CAPACITY_EXHAUSTED,
            f"{piece.slug}: solver exhausted its 3 attempts — last diagnostic: {diagnostic}",
            record.story_number,
            add_blocked=True,
        )
    old_role = piece.role
    successor = _SUCCESSOR[old_role]
    revision = piece.revision + 1
    prior = piece.assignments[-1]
    envelope = {
        "version": 1,
        "slice_ref": prior["slice_ref"],
        "revision": revision,
        "role": successor,
        "config": record.config[successor],
        "signals": prior["signals"],
        "evidence": prior["evidence"],
        "reason": (
            f"Escalation revision {revision}: {old_role} exhausted its 3 attempts "
            f"(last diagnostic: {diagnostic}); raised exactly one level, signals unchanged."
        ),
    }
    # Validated against the still-unmutated piece: a rejection must leave
    # the exhausted role's record exactly as it was, not a successor role
    # with a fresh, never-run attempt count.
    try:
        assignment.validate_envelope(
            envelope,
            role=successor,
            revision=revision,
            config=agents.roster_entry(successor),
            retained=retained_inputs(record.story_number, piece.layer, len(piece.acceptance)),
        )
    except assignment.AssignmentError as error:
        with record.transition():
            piece.move("escalating")
            piece.move("failed")
            record.save()
        raise FlowFailure(
            Outcome.PLAN_REJECTED,
            f"escalation assignment for {piece.slug} rejected: {error}",
            record.story_number,
            add_blocked=True,
        ) from error
    with record.transition():
        piece.move("escalating")
        piece.role = successor
        piece.revision = revision
        piece.attempts = 0
        piece.assignments.append(envelope)
        piece.move("assigned")
        record.save()
    narrate.line(
        f"⏫ #{piece.number} ({piece.layer}) escalating {old_role} → {successor} "
        f"(revision {piece.revision}, attempts reset)"
    )
    narrate.fields(
        [
            ("Backend", envelope["config"]["backend"]),
            ("Model", envelope["config"]["model"]),
            ("Effort", envelope["config"]["effort"]),
        ]
    )


def _validate_turn(
    record: RunRecord, piece: SliceRecord, reply: dict, frozen_ok: bool = False
) -> str | None:
    """The driver's own independent check of one implementation turn:
    scope, acceptance bytes, the acceptance run and the gates, all on the
    actual diff, and only then the reply's own account of it. Returns a
    repairable diagnostic; contract violations and tooling failures raise
    at once and never consume a correction."""
    with record.transition():
        piece.move("validating")
        record.save()
    narrate.line(f"📦 Validating #{piece.number} ({piece.layer})")
    _check_reply_structure(record, piece, reply)
    with narrate.grouped():
        narrate.fields([("Reported files", ", ".join(reply["changed_files"]))])
    path = worktrees.slice_worktree_path(piece.slug)
    changed = _check_worktree_state(record, piece, path, frozen_ok=frozen_ok)
    if not changed:
        phantom = ", ".join(sorted(set(reply["changed_files"])))
        return f"no changes were made in the worktree; phantom {phantom}"
    _check_scope(record, piece, changed)
    _check_acceptance_unchanged(record, piece, path, changed)
    verdict = acceptance.run_and_check_passing(path, piece.test_files)
    if not verdict.ok:
        if not verdict.repairable:
            raise FlowFailure(
                Outcome.TOOL_FAILED, verdict.why, record.story_number, add_blocked=True
            )
        _check_acceptance_is_sound(record, piece, verdict)
        return verdict.why
    gate_diagnostic = gates.run_turn_gates(path, record.story_number)
    if gate_diagnostic is not None:
        return gate_diagnostic
    mismatch = _report_mismatch(reply["changed_files"], changed)
    if mismatch is not None:
        return mismatch
    narrate.line(
        f"🔍 Verify #{piece.number}: scope ✔ · acceptance pass ✔ · branch identity ✔ · "
        "no gate files ✔"
    )
    return None


def _check_acceptance_is_sound(record: RunRecord, piece: SliceRecord, verdict) -> None:
    """An acceptance test that throws inside itself or a test helper is
    defective and no implementation can make it pass, so the run stops and
    names block 1 rather than spending the implementer's corrections on it.
    A throw from product code is an ordinary implementation bug and stays
    with the correction loop."""
    broken = [
        failure
        for failure in verdict.defects
        if failure_reason.blames_the_test(failure, piece.test_files)
    ]
    if not broken:
        return
    raise FlowFailure(
        Outcome.TESTS_INVALID,
        f"{piece.slug}: block 1 accepted a defective acceptance test - "
        f"{failure_reason.describe(broken)}; repair the test and run the story again",
        record.story_number,
        add_blocked=True,
    )


def _check_worktree_state(
    record: RunRecord, piece: SliceRecord, path, frozen_ok: bool = False
) -> list[str] | None:
    head = worktrees.local_head(path)
    # A review fix turn runs after the driver's freeze commit, so its HEAD
    # is the frozen commit; anything else is an agent commit.
    if head != piece.failing_sha and (not frozen_ok or head != piece.frozen_commit):
        raise _contract(
            record, piece, f"local HEAD moved to {head[:7]}; implementation agents never commit"
        )
    if worktrees.remote_head(piece.slug) != piece.failing_sha:
        raise _contract(record, piece, "branch was pushed; implementation agents never push")
    if head == piece.failing_sha:
        changed = worktrees.changed_since(path, piece.failing_sha)
    else:
        changed = worktrees.changed_between(path, piece.failing_sha)
    return changed or None


def _check_reply_structure(record: RunRecord, piece: SliceRecord, reply: object) -> None:
    if not isinstance(reply, dict) or set(reply) != {"changed_files", "summary"}:
        raise _contract(record, piece, "reply must have exactly changed_files and summary")
    files = reply["changed_files"]
    if (
        not isinstance(files, list)
        or not files
        or any(not isinstance(item, str) or not item.strip() for item in files)
    ):
        raise _contract(record, piece, "changed_files must be a non-empty array of paths")
    if not isinstance(reply["summary"], str) or not reply["summary"].strip():
        raise _contract(record, piece, "summary must be a non-empty string")


def _report_mismatch(reported: list[str], changed: list[str]) -> str | None:
    """The reply must describe exactly the actual diff. Nothing the driver
    trusts comes from the report - scope, the layer boundary, acceptance
    immutability and the gates all run on the real diff - so a divergence
    is an honest defect in the ledger the same agent repairs in one turn,
    not tampering. Returns the diagnostic, or None when they agree."""
    if set(reported) == set(changed):
        return None
    unreported = sorted(set(changed) - set(reported))
    phantom = sorted(set(reported) - set(changed))
    sides = [
        f"{name} {', '.join(paths)}"
        for name, paths in (("unreported", unreported), ("phantom", phantom))
        if paths
    ]
    return (
        "reported files do not match the actual diff: "
        + "; ".join(sides)
        + " — list every path the diff touches, including deleted and renamed files"
    )


def _check_scope(record: RunRecord, piece: SliceRecord, changed: list[str]) -> None:
    for changed_file in changed:
        basename = PurePosixPath(changed_file).name
        if (
            changed_file.startswith(_FORBIDDEN_PREFIXES)
            or basename in _FORBIDDEN_FILES
            or basename.endswith((".snap", ".lock"))
        ):
            raise _contract(record, piece, f"forbidden file changed: {changed_file}")
        boundary = layers.rejects_for_layer(piece.layer, changed_file)
        if boundary is not None:
            raise _contract(record, piece, boundary)


def _check_acceptance_unchanged(
    record: RunRecord, piece: SliceRecord, path, changed: list[str]
) -> None:
    """Removing, skipping, weakening or replacing the retained acceptance
    tests is a contract failure - their bytes must be untouched."""
    for test_file in piece.test_files:
        if test_file not in changed:
            continue
        recorded = worktrees.content_at(path, piece.failing_sha, test_file)
        if recorded is None:
            raise _contract(
                record, piece, f"acceptance test {test_file} missing at the recorded commit"
            )
        if (path / test_file).read_text() != recorded:
            raise _contract(
                record,
                piece,
                f"acceptance test {test_file} was modified; its bytes must not change",
            )


def _freeze(record: RunRecord, piece: SliceRecord) -> None:
    """Driver-controlled local commit, then the slice is frozen: never
    rerun while its sibling corrects or escalates."""
    sha = worktrees.commit_all(
        worktrees.slice_worktree_path(piece.slug),
        f"feat: implement {piece.layer} slice for #{piece.number}",
    )
    with record.transition():
        piece.implementation_sha = sha
        piece.frozen_commit = sha
        piece.move("succeeded")
        record.save()
    narrate.line(f"🔒 #{piece.number} ({piece.layer}) frozen at {sha[:12]}")


def _verify_frozen(record: RunRecord) -> None:
    """The join releases only when every slice succeeded and its frozen
    commit is still exactly what was approved."""
    for piece in record.ordered():
        path = worktrees.slice_worktree_path(piece.slug)
        if piece.state != "succeeded":
            raise FlowFailure(
                Outcome.CAPACITY_EXHAUSTED,
                f"{piece.slug} did not succeed (state {piece.state})",
                record.story_number,
                add_blocked=True,
            )
        if worktrees.local_head(path) != piece.frozen_commit or not worktrees.is_clean(path):
            raise FlowFailure(
                Outcome.AGENT_BROKE_CONTRACT,
                f"frozen slice {piece.slug} changed after approval",
                record.story_number,
                add_blocked=True,
            )


# Block 4 re-verifies the join before anything is pushed; a public name for
# the same check so deliver.py does not reach into privates.
verify_frozen = _verify_frozen


def _report(story, record: RunRecord) -> None:
    parts = ", ".join(
        f"#{piece.number} {piece.layer} ({piece.role}, {piece.frozen_commit[:12]})"
        for piece in record.ordered()
    )
    body = f"Implemented: {parts}. Gates passed. Next: block 4, review and delivery."
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    narrate.line(f"🏁 Implemented #{story.number} → {parts} · next: block 4, review")


def _contract(record: RunRecord, piece: SliceRecord, why: str) -> FlowFailure:
    return FlowFailure(
        Outcome.AGENT_BROKE_CONTRACT,
        f"{piece.slug}: {why}",
        record.story_number,
        add_blocked=True,
    )
