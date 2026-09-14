"""Box: implement and validate - one bounded level loop per slice.

Each slice gets one initial implementation turn plus at most two
corrections in the same role, session and worktree. A repairable failure
at attempt 3 escalates exactly one rung (mechanic → builder → solver) with
a new assignment revision, a new identity and reset attempts, reusing the
same issue, team, branch, worktree and accumulated implementation. An
exhausted solver stops the run and preserves everything. External and
contract failures stop immediately without consuming a correction.

Two attempts are enough when they fail the same way: a diagnostic that
comes back identical after a corrective turn (fitflow.diagnostics) ends
the role's budget where it stands and escalates exactly as exhaustion
would - the remaining attempts would only reproduce it, while the
stronger role is the thing that has not been tried.

A turn may also reject the acceptance tests instead of implementing against
them. The driver verifies that objection itself (steps/objection.py) and,
when it stands, sends the tests back to block 1's writer, re-freezes the
repaired set onto the slice branch and relaunches the slice with a fresh
attempt counter. A refused objection is an ordinary failed attempt. Block
4's fix turns may object on the same terms: a verified objection there
costs only the turn, and the fix request goes on, on the same fix attempt,
against the repaired tests.

Two independent slices run their loops in parallel; a succeeded slice is
frozen - committed by the driver, never rerun while its sibling corrects or
escalates - and the join releases only when every slice is succeeded with
its frozen commit unchanged.

A UI slice that depends on its domain sibling (block 2's `depends_on`) is
not independent and does not run beside it: the domain loop runs first, the
driver then merges the frozen domain commit into the UI branch and pushes
it, and only then does the UI loop launch. If the domain slice never
freezes, the UI slice is never launched at all.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
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
from fitflow.diagnostics import same_diagnostic
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord, judged_failed, retained_inputs
from fitflow.steps import objection

_SUCCESSOR = {"mechanic": "builder", "builder": "solver"}
#: How many rerun-then-solo flake cycles one slice may spend in one run.
_FLAKE_CYCLES = 2
# The gates the agent is judged by: the quality policy, the CI workflows and
# the script folders that implement them stay out of reach of an
# implementation turn - and only those folders. `scripts/` also holds
# ordinary application tooling (the ETL pipeline, the search evaluation
# harness, the dev and build helpers) that a story may perfectly well be
# about, and forbidding the whole tree cost #337 a turn on `scripts/eval/`.
# `workflow/` is deliberately absent too - an agent may implement changes
# to the driver itself (it edits a worktree copy; the running driver is the
# main checkout's code, and the driver's own suite runs in CI's "Workflow
# driver" job, not in this block's validation). What the driver never does
# is merge such a change: block 4 hands that pull request to Gabriel.
_FORBIDDEN_PREFIXES = (
    ".github/",
    "quality/",
    "scripts/ci/",
    "scripts/deploy/",
    "scripts/github/",
    "scripts/quality/",
    "scripts/security/",
)
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


@dataclass(frozen=True)
class _Rejection:
    """One rejected implementation turn: the diagnostic the same agent is
    corrected with, and - when the turn broke the contract rather than
    merely failed - the message the run stops with once the correction
    budget is spent. A breach is not escalated to a stronger role: no
    model is the answer to "you changed a file you may not change"."""

    diagnostic: str
    breach: str | None = None


def forbidden_brief(layer: str = "") -> str:
    """The prohibition the scope check enforces, rendered for the
    implementer's brief from the same constants it validates against, so
    the rule the agent is told and the rule it is judged by cannot drift.
    #337 stopped on `scripts/eval/` precisely because the brief said
    "quality/gate policy files" and named no path at all.

    A layer that owns one of these repository-wide files - the workflow
    layer owns `cspell.json`, whose new word travels with the prose that
    needs it - must not be told it is out of reach, for the same reason."""
    files = sorted(name for name in _FORBIDDEN_FILES if not layers.permits_gate_file(layer, name))
    return "\n".join(
        [
            f"- anything under {_listed(_FORBIDDEN_PREFIXES)}",
            f"- any file named {_listed(files)}, wherever it sits",
            "- any snapshot (`*.snap`) or lock file (`*.lock`)",
            "- the acceptance test files listed above",
        ]
    )


def _listed(names) -> str:
    return ", ".join(f"`{name}`" for name in names)


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
    """The slices still to run. A dependent UI slice makes this sequential;
    two independent ones run in parallel.

    This is also where a resumed run reconciles the dependency rather than
    steps/resume.py: `_bring_in_sibling` is the same step in both cases and
    it is idempotent, so a UI slice whose domain sibling is already frozen
    goes through it here whether its merge was made by this run or by the
    one that stopped."""
    if not pieces:
        return
    dependent = _dependent_ui(record, pieces)
    if dependent is not None:
        _run_dependent_loops(record, pieces, dependent)
        return
    if len(pieces) == 1:
        _run_slice(record, pieces[0])
        return
    narrate.line(f"⚡ Starting {len(pieces)} implementation loops in parallel")
    failures = _run_parallel(record, pieces)
    narrate.line(f"⏳ Implementation barrier: all {len(pieces)} slices settled")
    if failures:
        for piece, failure in failures:
            narrate.line(f"❌ #{piece.number} ({piece.layer}): {_describe(failure)}")
        raise failures[0][1]


def _dependent_ui(record: RunRecord, pieces: list[SliceRecord]) -> SliceRecord | None:
    """The UI slice waiting for its domain sibling, when it is one of the
    slices still to run."""
    for piece in pieces:
        if piece.depends_on == "domain" and "domain" in record.slices:
            return piece
    return None


def _run_dependent_loops(
    record: RunRecord, pieces: list[SliceRecord], ui_piece: SliceRecord
) -> None:
    """Domain first, then the UI loop on a driver-made merge of the frozen
    domain commit. A domain slice that never freezes stops the run here and
    the UI slice is never launched: it keeps the state block 2 left it in."""
    domain = record.slices["domain"]
    narrate.line(f"⛓️ #{ui_piece.number} (ui) waits for #{domain.number} (domain)")
    if domain in pieces:
        try:
            _run_slice(record, domain)
        except Exception as error:
            narrate.line(f"❌ #{domain.number} (domain): {_describe(error)}")
            narrate.line(
                f"⛓️ #{ui_piece.number} (ui) not launched: waits for #{domain.number} (domain)"
            )
            raise
    _bring_in_sibling(record, ui_piece, domain)
    _run_slice(record, ui_piece)


def _bring_in_sibling(record: RunRecord, piece: SliceRecord, sibling: SliceRecord) -> None:
    """The driver-controlled step between the two loops: merge the sibling's
    frozen commit into this slice's branch and push it, so the implementer
    works on a tree where the behavior it renders actually exists.

    `failing_sha` becomes that merge commit - it is the base every later
    check compares HEAD, origin and the diff against - while `tests_sha`
    keeps naming block 1's commit, which is what acceptance immutability
    means. Already merged (a resumed run) is a no-op."""
    path = worktrees.slice_worktree_path(piece.slug)
    if piece.sibling_merged:
        _verify_sibling_merged(record, piece, path)
        return
    narrate.line(
        f"⛓️ Bringing #{sibling.number} ({sibling.layer}) {sibling.frozen_commit[:12]} "
        f"into #{piece.number} ({piece.layer})"
    )
    try:
        worktrees.merge_sibling(
            path,
            sibling.frozen_commit,
            f"chore: bring in the {sibling.layer} slice for #{piece.number}",
        )
    except Exception as error:
        worktrees.abort_merge(path)
        raise FlowFailure(
            Outcome.PLAN_REJECTED,
            f"{piece.slug}: merging the frozen {sibling.layer} slice "
            f"{sibling.frozen_commit[:12]} into it conflicts, so the two slices are not "
            f"the layered pair the plan claimed; a revised plan in a new run is required "
            f"({_describe(error)})",
            record.story_number,
            add_blocked=True,
        ) from error
    merged = worktrees.local_head(path)
    worktrees.push_branch(path, piece.branch)
    with record.transition():
        piece.failing_sha = merged
        piece.sibling_merged = sibling.frozen_commit
        record.save()
    narrate.line(f"⇪ Pushed {piece.branch} at {merged[:12]}")
    _require_acceptance_still_fails(record, piece, path)


def _verify_sibling_merged(record: RunRecord, piece: SliceRecord, path) -> None:
    if not worktrees.is_ancestor(path, piece.sibling_merged):
        raise _contract(
            record,
            piece,
            f"the retained merge of the {piece.depends_on} slice "
            f"{piece.sibling_merged[:12]} is no longer in this branch's history",
        )
    narrate.line(
        f"⛓️ #{piece.number} ({piece.layer}) already carries the {piece.depends_on} slice "
        f"at {piece.sibling_merged[:12]}"
    )


def _require_acceptance_still_fails(record: RunRecord, piece: SliceRecord, path) -> None:
    """Block 1's verdict, re-taken on the merged tree: these tests must
    still fail, or there is nothing left for this slice to implement."""
    verdict = acceptance.run_and_check_failing(path, piece.test_files)
    if verdict.ok:
        narrate.line(
            f"🧪 {', '.join(piece.test_files)} → still failed on the merged tree, as it should ✔"
        )
        return
    if not verdict.repairable:
        raise FlowFailure(Outcome.TOOL_FAILED, verdict.why, record.story_number, add_blocked=True)
    raise FlowFailure(
        Outcome.TESTS_DO_NOT_FAIL,
        f"{piece.slug}: the {piece.depends_on} slice alone satisfies the "
        f"{piece.layer} acceptance tests, so this slice has nothing left to "
        f"implement ({verdict.why}); a revised plan in a new run is required",
        record.story_number,
        add_blocked=True,
    )


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
    the reply and worktree the turn left - no new agent call. One that
    arrives "correcting" carries a verdict the driver already reached, and
    the loop simply launches the next attempt against its diagnostic -
    including the one attempt past the budget a resume grants when the
    driver's own rejection spent it. A resumed slice may also arrive
    "tests_rejected", with block 1's repair of its acceptance tests
    unfinished: that repair is relaunched before any turn of this loop."""
    if piece.state == "tests_rejected":
        objection.repair(record, piece)
    if piece.state == "running":
        last = piece.turns[-1]
        narrate.line(
            f"♻️  #{piece.number} ({piece.layer}) re-validating {piece.role} attempt "
            f"{last['attempt']} from its retained reply, without a new agent call"
        )
        if _settle_or_repair(record, piece, last["reply"], piece.attempts):
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
        if _settle_or_repair(record, piece, reply, attempt):
            return


def _settle_or_repair(record: RunRecord, piece: SliceRecord, reply: dict, attempt: int) -> bool:
    """`_settle`, plus the one verdict it cannot settle on its own: a
    verified objection to the acceptance tests, which sends them back to
    block 1 and relaunches this slice on the repaired set."""
    try:
        return _settle(record, piece, reply, attempt)
    except objection.Objected:
        objection.repair(record, piece)
        return False


def _settle(record: RunRecord, piece: SliceRecord, reply: dict, attempt: int) -> bool:
    """Judge one completed turn. True once the slice is frozen; False when
    the loop must launch again (a correction, or the escalated role's first
    attempt); raises when the run stops.

    A rejection identical to the previous attempt's spends no further
    attempt: an agent told the same thing twice and reaching the same
    verdict has shown the diagnostic, not the reply, is what needs to
    change."""
    try:
        refused = objection.consider(record, piece, reply, scope_breach)
        rejection = _Rejection(refused) if refused else _validate_turn(record, piece, reply)
    except FlowFailure as failure:
        _settle_as_failed(record, piece, failure.why)
        raise
    if rejection is None:
        _freeze(record, piece)
        return True
    # the last attempt has no successor to save: it is exhaustion either way
    repeated = attempt < turns.BUDGET and same_diagnostic(
        _previous_diagnostic(piece, attempt), rejection.diagnostic
    )
    _record_diagnostic(record, piece, rejection.diagnostic, repeated)
    narrate.headed(f"🩺 #{piece.number} ({piece.layer}) diagnostic: ", rejection.diagnostic)
    if attempt < turns.BUDGET and not repeated:
        _to_correcting(record, piece, attempt)
        return False
    _end_of_budget(record, piece, rejection, attempt, repeated)
    return False


def _previous_diagnostic(piece: SliceRecord, attempt: int) -> str:
    """The diagnostic the attempt immediately before this one was rejected
    with, or "" when there is none: the role's first attempt, or the first
    attempt of an escalated role, which must never read as a repetition -
    the stronger role is exactly the thing that has not been tried yet."""
    for entry in reversed(piece.turns[:-1]):
        if entry["result"] == "void":
            continue  # a resume voided it and the attempt was relaunched
        if (entry["role"], entry["revision"], entry["attempt"]) == (
            piece.role,
            piece.revision,
            attempt - 1,
        ):
            return entry.get("diagnostic", "")
        return ""
    return ""


def _record_diagnostic(
    record: RunRecord, piece: SliceRecord, diagnostic: str, repeated: bool
) -> None:
    """The rejection, on the slice's diagnostics and on the turn that
    earned it. `repeated` marks the turn the loop stopped on rather than
    corrected from, so the audit and `--resume` can both see it."""
    with record.transition():
        piece.diagnostics.append(diagnostic)
        piece.turns[-1]["diagnostic"] = diagnostic
        if repeated:
            piece.turns[-1]["repeated"] = True
        record.save()


def _end_of_budget(
    record: RunRecord, piece: SliceRecord, rejection: _Rejection, attempt: int, repeated: bool
) -> None:
    """This role is done with the slice, either because its attempts ran
    out or because the diagnostic came back identical and the rest would
    only reproduce it. Both end the same way: a contract breach stops the
    run, and anything else escalates one rung, so the stronger role still
    gets its chance."""
    if repeated:
        narrate.headed(
            f"🛑 {piece.role.capitalize()} #{piece.number} ({piece.layer}) stopped early: "
            f"attempt {attempt} failed exactly as attempt {attempt - 1} — ",
            rejection.diagnostic,
        )
    if rejection.breach is not None:
        breach = rejection.breach
        if repeated:
            breach = f"{breach} ({turns.unspent_attempts(attempt)})"
        failure = _contract(record, piece, breach)
        _settle_as_failed(record, piece, failure.why)
        raise failure
    _escalate_or_stop(record, piece, rejection.diagnostic, _budget_note(attempt, repeated))


def _budget_note(attempt: int, repeated: bool) -> str:
    """How this role's budget ended, for the escalation reason and the stop
    message: spent to the last attempt, or deliberately left unspent."""
    if repeated:
        return turns.unspent_attempts(attempt)
    return f"exhausted its {turns.BUDGET} attempts"


def _settle_as_failed(record: RunRecord, piece: SliceRecord, why: str) -> None:
    """A contract violation or external tool failure during validation
    still settles the turn: the slice lands in "failed" instead of being
    left in an active state, and the settled turn's verdict becomes the
    diagnostic, not a green."""
    with record.transition():
        piece.move("failed")
        piece.turns[-1]["result"] = "failed"
        piece.turns[-1]["why"] = why
        record.save()


def _to_correcting(record: RunRecord, piece: SliceRecord, attempt: int) -> None:
    with record.transition():
        piece.move("correcting")
        record.save()
    narrate.line(
        f"🔁 {piece.role.capitalize()} #{piece.number} ({piece.layer}) "
        f"correcting after attempt {attempt}"
    )


def narrate_turn_start(piece: SliceRecord, attempt: int) -> None:
    """An attempt past the budget is the one grace attempt a resume grants
    after a rejection the driver itself reached (steps/resume.py), and it
    is labelled as such rather than as an impossible 4/3."""
    scale = f"{attempt}/{turns.BUDGET}" if attempt <= turns.BUDGET else f"{attempt} (grace)"
    with narrate.grouped():
        narrate.line(
            f"🔧 {piece.role.capitalize()} #{piece.number} ({piece.layer}) attempt {scale}"
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
        forbidden=forbidden_brief(piece.layer),
        attempt=str(attempt),
        diagnostic=piece.diagnostics[-1] if piece.diagnostics else "",
        prior_diagnostics="\n".join(f"- {item}" for item in piece.diagnostics) or "(none)",
        objecting=objection.brief(),
        repair_note=_repair_note(piece),
        scope_note=_scope_note(piece),
    )


def _scope_note(piece: SliceRecord) -> str:
    """What this slice's scope is beyond its layer's ordinary boundary -
    the additive obligation of a domain slice the UI calls, or the widened
    reach of the ui slice that adopts it - rendered from the same module
    the scope check reads, and empty for every other slice."""
    note = layers.scope_note(piece.layer, piece.ui_called_exports, _adopts_domain(piece))
    return f"\n{note}\n" if note else ""


def _repair_note(piece: SliceRecord) -> str:
    """What a slice whose tests block 1 already repaired tells its next
    initial turn. Empty for every other turn, so the brief reads exactly as
    it did before an objection was possible."""
    if not piece.test_repair_note:
        return ""
    return f"\nThe acceptance tests changed since your last turn:\n\n{piece.test_repair_note}\n"


def review_fix_turn(record: RunRecord, piece: SliceRecord, diagnostic: str) -> None:
    """One block 4 fix request: the review findings (or the red CI's log) as
    the diagnostic, then up to `turns.BUDGET` turns in the same role, session
    and worktree to satisfy it - each judged by the full block 3 validation,
    each corrected from its own diagnostic, and the one that passes sealed
    with a new driver-made freeze commit.

    This is the one sanctioned exit from `succeeded`; the turns are recorded
    with kind `review_fix` and do not consume block 3's attempt budget - the
    fix request has its own, the same size and with the same repetition rule
    (#428): a rejection identical to the previous attempt's ends the request
    where it stands, because the agent has already been told that and the
    verdict did not move. Exhaustion, early or not, is CAPACITY_EXHAUSTED and
    `blocked`: block 3's escalation ladder is spent by definition once the
    slice succeeded, so what is left is a human call."""
    with record.transition():
        piece.diagnostics.append(diagnostic)
        record.save()
    _fix_attempts(record, piece, 1)


def resume_review_fix(record: RunRecord, piece: SliceRecord) -> None:
    """Continue a fix request a stopped run left unfinished. A turn that
    ended with a reply and no verdict is judged again on the bytes it left
    - the same re-derivation block 3's resume makes, and no new agent call;
    a turn the driver never saw end has been voided already and is
    relaunched under the same attempt of the same budget.

    A turn already carrying a verdict - rejected on its merits, not
    interrupted by a failing tool - is neither: that verdict is on the
    ledger, and re-deriving it on the same bytes could only reach it again.
    That turn is relaunched, one attempt further on."""
    last = piece.turns[-1]
    attempt = int(last.get("fix_attempt", 1))
    # an objected turn's objection was verified and its repair has landed:
    # the request goes on at the attempt that objected
    if last["result"] in ("void", "objected") or last.get("reply") is None:
        _fix_attempts(record, piece, attempt)
        return
    if judged_failed(last):
        _relaunch_failed_fix(record, piece, attempt)
        return
    narrate.line(
        f"♻️  #{piece.number} ({piece.layer}) re-validating its review fix attempt "
        f"{attempt} from its retained reply, without a new agent call"
    )
    try:
        if _settle_fix(record, piece, attempt):
            return
    except objection.Objected:
        objection.repair(record, piece)
        _fix_attempts(record, piece, attempt)
        return
    _fix_attempts(record, piece, attempt + 1)


def _relaunch_failed_fix(record: RunRecord, piece: SliceRecord, attempt: int) -> None:
    """The retained turn was judged and rejected, so the request continues
    at the next attempt. When the budget has none left the request still
    gets exactly one: the run was resumed because the driver was fixed, and
    the verdict that spent the last attempt was the driver's own (#420 run
    3 rejected a correct reply on a diff it had read wrong). One grace
    attempt, and the ordinary exhaustion if it fails too."""
    if attempt < turns.BUDGET:
        _fix_attempts(record, piece, attempt + 1)
        return
    narrate.line(
        f"♻️  #{piece.number} ({piece.layer}) has spent its {turns.BUDGET} fix attempts: "
        "granting one grace attempt after a driver-side rejection"
    )
    _fix_attempts(record, piece, attempt + 1, last=attempt + 1)


def _fix_attempts(
    record: RunRecord, piece: SliceRecord, first: int, last: int = turns.BUDGET
) -> None:
    """Fix attempts `first` to `last`. A turn whose objection to the tests
    the driver verified is not an attempt spent: block 1 repairs the tests,
    and the same attempt is launched again against them. The repair budget
    bounds that loop - a third verified objection stops the run."""
    attempt = first
    while attempt <= last:
        _launch_fix_turn(record, piece, attempt)
        try:
            if _settle_fix(record, piece, attempt):
                return
        except objection.Objected:
            objection.repair(record, piece)
            continue
        attempt += 1
    raise AssertionError("unreachable: the last attempt settles or raises")


def _launch_fix_turn(record: RunRecord, piece: SliceRecord, attempt: int) -> None:
    """One fix turn, launched and recorded. The reply and the working tree's
    digest are persisted with it, exactly as a block 3 turn's are, so a run
    that dies between this turn and its verdict can have that verdict
    re-derived instead of paying for the turn twice."""
    _pre_turn_barrier(record, piece)
    with record.transition():
        piece.move("fixing")
        piece.attempts += 1
        identity = record.begin_turn(piece, piece.role, piece.attempts, "review_fix")
        piece.turns[-1]["fix_attempt"] = attempt
        piece.turns[-1]["diff_base"] = piece.failing_sha
        record.save()
    scale = f"{attempt}/{turns.BUDGET}" if attempt <= turns.BUDGET else f"{attempt} (grace)"
    narrate.line(
        f"🔧 {piece.role.capitalize()} #{piece.number} ({piece.layer}) review fix attempt {scale}"
    )
    reply, session = _launch_turn(record, piece, identity, "correct_implementation", piece.attempts)
    with record.transition():
        digest = worktrees.working_tree_digest(worktrees.slice_worktree_path(piece.slug))
        record.end_turn(piece, identity, "ok", reply["summary"], session, reply, digest)


def _settle_fix(record: RunRecord, piece: SliceRecord, attempt: int) -> bool:
    """Judge one completed fix turn. True once the slice is frozen again,
    False when another corrective turn is owed, and raises when the request
    is spent - or `objection.Objected` when the turn's objection to the tests
    verified, which the caller answers with block 1's repair.

    The objection is considered first, exactly as block 3's `_settle` does:
    one the driver refuses is this attempt's diagnostic like any other."""
    reply = piece.turns[-1]["reply"]
    try:
        refused = objection.consider(record, piece, reply, scope_breach, fix_turn=True)
        rejection = (
            _Rejection(refused) if refused else _validate_turn(record, piece, reply, fix_turn=True)
        )
    except FlowFailure as failure:
        _settle_as_failed(record, piece, failure.why)
        raise
    if rejection is None:
        _freeze(record, piece)
        return True
    repeated = attempt < turns.BUDGET and same_diagnostic(
        _previous_diagnostic(piece, piece.turns[-1]["attempt"]), rejection.diagnostic
    )
    _record_diagnostic(record, piece, rejection.diagnostic, repeated)
    narrate.headed(
        f"🩺 #{piece.number} ({piece.layer}) review fix diagnostic: ", rejection.diagnostic
    )
    if attempt < turns.BUDGET and not repeated:
        narrate.line(
            f"🔁 {piece.role.capitalize()} #{piece.number} ({piece.layer}) correcting its "
            f"review fix after attempt {attempt}"
        )
        return False
    _end_of_fix_budget(record, piece, rejection, attempt, repeated)
    return False


def _end_of_fix_budget(
    record: RunRecord, piece: SliceRecord, rejection: _Rejection, attempt: int, repeated: bool
) -> None:
    """The fix request is done: its attempts ran out, or the diagnostic came
    back identical and the rest would only reproduce it. Either way the run
    stops where it always did - CAPACITY_EXHAUSTED and `blocked`, because
    block 3's escalation ladder is spent once the slice succeeded. A scope
    breach ends it the same way every other rejection does: correctable
    while the budget lasts (#419), and no more than that."""
    head = (
        f"🛑 #{piece.number} ({piece.layer}) review fix stopped early: attempt {attempt} "
        f"failed exactly as attempt {attempt - 1} — "
        if repeated
        else f"🛑 #{piece.number} ({piece.layer}) review fix exhausted {turns.BUDGET} attempts — "
    )
    narrate.headed(head, rejection.diagnostic)
    note = (
        turns.unspent_attempts(attempt) if repeated else f"spent all {turns.BUDGET} of its attempts"
    )
    why = f"{piece.slug}: the review fix turn failed validation: {rejection.diagnostic} ({note})"
    _settle_as_failed(record, piece, why)
    raise FlowFailure(Outcome.CAPACITY_EXHAUSTED, why, record.story_number, add_blocked=True)


def _escalate_or_stop(
    record: RunRecord, piece: SliceRecord, diagnostic: str, budget_note: str
) -> None:
    if piece.role == "solver":
        with record.transition():
            piece.move("failed")
            record.save()
        raise FlowFailure(
            Outcome.CAPACITY_EXHAUSTED,
            f"{piece.slug}: solver {budget_note} — last diagnostic: {diagnostic}",
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
            f"Escalation revision {revision}: {old_role} {budget_note} "
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
    record: RunRecord, piece: SliceRecord, reply: dict, fix_turn: bool = False
) -> _Rejection | None:
    """The driver's own independent check of one implementation turn:
    acceptance bytes, scope, the acceptance run and the gates, all on the
    actual diff, and only then the reply's own account of it. Returns the
    rejection to correct from; tooling failures and the one contract
    violation no correction may undo - a changed acceptance test - raise at
    once and never consume a correction.

    `fix_turn` says this is one of block 4's fix turns rather than a block 3
    implementation turn: its worktree is legitimately at the driver's freeze
    commit, and its gate failures are eligible for the one flake rerun
    `_judge_gates` describes."""
    with record.transition():
        piece.move("validating")
        record.save()
    narrate.line(f"📦 Validating #{piece.number} ({piece.layer})")
    _check_reply_structure(record, piece, reply)
    with narrate.grouped():
        narrate.fields([("Reported files", ", ".join(reply["changed_files"]))])
    path = worktrees.slice_worktree_path(piece.slug)
    if fix_turn:
        no_op = _changed_nothing(piece, path)
        if no_op is not None:
            return _Rejection(no_op)
    changed = _check_worktree_state(
        record, piece, path, frozen_ok=fix_turn, base=_diff_base(piece, fix_turn)
    )
    if not changed:
        phantom = ", ".join(sorted(set(reply["changed_files"])))
        return _Rejection(f"no changes were made in the worktree; phantom {phantom}")
    # the acceptance bytes are judged first and terminally: that
    # immutability is the contract itself, so a scope violation in the same
    # diff must never soften it into a correction
    _check_acceptance_unchanged(record, piece, path, changed)
    out_of_reach = _check_scope(piece, changed)
    if out_of_reach is not None:
        return out_of_reach
    return _validate_behavior(record, piece, path, reply, changed)


def _validate_behavior(
    record: RunRecord, piece: SliceRecord, path, reply: dict, changed: list[str]
) -> _Rejection | None:
    """The acceptance run, the turn gates and the reply's account of the
    diff, in that order: every verdict taken on the real tree outranks what
    the reply says about it."""
    verdict = acceptance.run_and_check_passing(path, piece.test_files)
    if not verdict.ok:
        if not verdict.repairable:
            raise FlowFailure(
                Outcome.TOOL_FAILED, verdict.why, record.story_number, add_blocked=True
            )
        _check_acceptance_is_sound(record, piece, verdict)
        return _Rejection(verdict.why)
    gate_failure = _judge_gates(record, piece, path, changed)
    if gate_failure is not None:
        _check_gate_blames_the_implementation(record, piece, gate_failure)
        return _Rejection(_gate_rejection(piece, gate_failure))
    _correct_report(record, piece, reply, changed)
    narrate.line(
        f"🔍 Verify #{piece.number}: scope ✔ · acceptance pass ✔ · branch identity ✔ · "
        "no gate files ✔"
    )
    return None


def _judge_gates(
    record: RunRecord, piece: SliceRecord, path, changed: list[str]
) -> "gates.GateFailure | None":
    """The gates' verdict on this turn, and the rerun-then-solo cycle a
    failure earns when it is not plausibly about this turn's work.

    Every turn is judged by the whole tier rather than by its own diff, so
    it inherits every test in it - including files this slice never touched.
    A failure confined to those is the flake's case (#420 lost a run to
    `src/routes/sync.e2e.ts`, which its slice never touched, which passes
    alone, and which CI was green on), and it is answered by running the
    tier again once and then, if it fails the same way, by running those
    files alone. A solo pass is a local flake: it is recorded, narrated and
    let through, and CI remains the judge. A solo failure is a real failure
    and counts. A failure naming anything the diff touches is never rerun -
    that one is about the work."""
    failure = _run_turn_gates(record, piece, path, changed)
    if failure is None:
        _record_gate_pass(record, piece)
        return None
    if not _untouched_flake(piece, path, changed, failure):
        return failure
    if piece.flake_cycles >= _FLAKE_CYCLES:
        narrate.line(
            f"🛑 {_failed_step(piece, failure)} failed again in files this slice does not "
            f"touch, but #{piece.number} ({piece.layer}) has spent its {_FLAKE_CYCLES} flake "
            "reruns this run — the failure counts"
        )
        return failure
    return _rerun_then_solo(record, piece, path, changed, failure)


def _rerun_then_solo(
    record: RunRecord, piece: SliceRecord, path, changed: list[str], failure: "gates.GateFailure"
) -> "gates.GateFailure | None":
    """One flake cycle: the tier again, and - when it fails the same way -
    the blamed files alone. Both halves are spent together and counted as
    one, so a slice gets at most `_FLAKE_CYCLES` of them in a run."""
    narrate.line(
        f"🔁 {_failed_step(piece, failure)} failed in {', '.join(sorted(failure.blamed_files))}, "
        f"which this slice does not touch{_last_pass(piece)} — rerunning once"
    )
    with record.transition():
        piece.flake_cycles += 1
        record.save()
    again = _run_turn_gates(record, piece, path, changed)
    if again is None:
        _record_gate_pass(record, piece)
        narrate.line(f"✅ {_gate_name(piece)} passed on the rerun: the first run was a flake")
        return None
    if again.blamed_files != failure.blamed_files or not _untouched_flake(
        piece, path, changed, again
    ):
        return again
    return _solo_run(record, piece, path, again)


def _solo_run(
    record: RunRecord, piece: SliceRecord, path, failure: "gates.GateFailure"
) -> "gates.GateFailure | None":
    """The blamed files run on their own, once. A pass is the flake's
    signature - the file fails inside the whole suite and passes outside it
    - and the tier is treated as passed for this turn. A failure is a real
    failure and goes to the budget. A run that produced no verdict at all
    concludes nothing, and the original failure stands."""
    files = sorted(failure.blamed_files)
    report = acceptance.run_and_report(path, files, failure.project)
    if not report.ok:
        narrate.line(f"❔ {', '.join(files)} could not be run alone ({report.why}) — it counts")
        return failure
    if any(status.failed for status in report.statuses):
        narrate.line(f"❌ {', '.join(files)} fails alone too — the failure is this turn's")
        return failure
    _record_flakes(record, piece, failure, files)
    narrate.line(
        f"🔁 {', '.join(files)} fails in the full suite and passes alone — a local flake "
        "in a file this slice does not touch; CI judges it"
    )
    return None


def _record_flakes(
    record: RunRecord, piece: SliceRecord, failure: "gates.GateFailure", files: list[str]
) -> None:
    """What the driver waved through, on the slice: one entry per blamed
    file, with the test the gate named, the step that failed and the time.
    Block 4 puts them in front of Gabriel."""
    when = time.strftime("%H:%M")
    step = _failed_step(piece, failure)
    titles = {test.file: test.title for test in failure.tests}
    with record.transition():
        piece.flakes.extend(
            {"file": name, "test": titles.get(name, ""), "step": step, "when": when}
            for name in files
        )
        record.save()


def _untouched_flake(
    piece: SliceRecord, path, changed: list[str], failure: "gates.GateFailure"
) -> bool:
    """Whether this gate failure is entirely about test files that are no
    part of this slice: not its own retained acceptance tests, and nothing
    its diff touches. Conservative in every direction: a failure whose
    steps did not all name what they blame concludes nothing, and one
    culprit outside the tests, inside the diff or among the slice's own
    tests disqualifies the whole failure - the acceptance tests are what
    this turn is judged against, so a failure in them is about the work
    however far from the diff they sit. No earlier pass is required -
    #420's record predated the ledger that held them, so an old record
    could never have earned a rerun, and a fresh one earns one only after
    a pass in the same run, which is exactly when the evidence is least
    needed."""
    if not failure.blamed:
        return False
    touched = _touched(piece, path, changed)
    return all(
        acceptance.is_test_file(piece.layer, name)
        and acceptance.owning_test(name, piece.test_files) is None
        and acceptance.matching_path(name, touched) is None
        for name in failure.blamed_files
    )


def _touched(piece: SliceRecord, path, changed: list[str]) -> list[str]:
    """Every file this slice's diff reaches: what the turn's own validation
    already read out of it, plus whatever the working tree still holds
    uncommitted. A file the turn edited without committing is touched by
    this slice however the diff is taken."""
    return [*changed, *worktrees.changed_since(path, piece.failing_sha)]


def _last_pass(piece: SliceRecord) -> str:
    """When this tier last passed for this slice, for the narration. It is
    evidence the rerun is worth making, never the condition for making
    one: a slice with no recorded pass is rerun just the same."""
    when = piece.gate_passes.get(_gate_name(piece))
    return f" and which passed at {when}" if when else ""


def _record_gate_pass(record: RunRecord, piece: SliceRecord) -> None:
    """When this slice's gates last passed: the time `_last_pass` quotes
    back when a rerun is narrated."""
    with record.transition():
        piece.gate_passes[_gate_name(piece)] = time.strftime("%H:%M")
        record.save()


def _gate_name(piece: SliceRecord) -> str:
    return "the driver's gates" if piece.layer == "workflow" else "verify:changed"


def _failed_step(piece: SliceRecord, failure: "gates.GateFailure") -> str:
    """The failed steps by name, or the gate itself when it runs as one."""
    return ", ".join(sorted(failure.steps)) or _gate_name(piece)


def _run_turn_gates(
    record: RunRecord, piece: SliceRecord, path, changed: list[str]
) -> "gates.GateFailure | None":
    """The gates this turn is judged by. A workflow slice changes Python and
    prose, which `verify:changed` neither sizes nor runs, so the driver's own
    gates stand in its place - the same four block 1 ran over the tests."""
    if piece.layer == "workflow":
        return gates.run_workflow_gates(path, record.story_number, changed)
    return gates.run_turn_gates(path, record.story_number)


@dataclass(frozen=True)
class _Blame:
    """Who a located gate failure blames. `acceptance` is the retained
    acceptance tests among its culprits, whose bytes no implementation turn
    may change; `others` is every other file it named, which is the
    implementer's share of the same failure."""

    acceptance: list[str]
    others: list[str]


def _blame(failure: gates.GateFailure, test_files: list[str]) -> _Blame:
    owners = {name: acceptance.owning_test(name, test_files) for name in failure.culprits}
    return _Blame(
        sorted({test for test in owners.values() if test is not None}),
        sorted(name for name, test in owners.items() if test is None),
    )


def _check_gate_blames_the_implementation(
    record: RunRecord, piece: SliceRecord, failure: gates.GateFailure
) -> None:
    """A gate failure every one of whose culprit files is a retained
    acceptance test is not repairable here: the only bytes that would fix it
    are the ones the implementer may never change. Block 1 accepted the
    defect, so the run stops and names it, instead of spending three
    attempts and an escalation on an impossible correction - which is
    exactly what a ten-line clone inside an acceptance test cost on #397.

    A mixed failure - some acceptance files, some the implementer's own -
    is still repairable, because the implementer's half is real work. It is
    told which half is not its own (`_gate_rejection`) and fixes the rest;
    the turn after that reaches this check with only the acceptance files
    blaming, and stops here. #422's solver spent its whole budget on a
    verdict that was one unknown word in a file it could not edit beside
    type errors it could have fixed, and was told the difference by
    nothing.

    Conservative by construction: a failure the driver could not locate
    concludes nothing. Neither does the one failure inside the acceptance
    tests that an implementation turn can answer - see
    `_owed_signatures`."""
    if not failure.located:
        return
    blame = _blame(failure, piece.test_files)
    if not blame.acceptance or blame.others:
        return
    if _owed_signatures(piece, failure, blame.acceptance):
        return
    raise FlowFailure(
        Outcome.TESTS_INVALID,
        f"{piece.slug}: block 1 accepted an acceptance test the repository gate rejects - "
        f"the failure is confined to {', '.join(blame.acceptance)}, whose bytes an "
        f"implementation turn may not change: {failure.diagnostic}; repair the test in "
        "block 1 and run the story again",
        record.story_number,
        add_blocked=True,
    )


#: The `verify:changed` steps an implementation turn answers by writing
#: product code rather than by changing the file they name. Every other step
#: (`duplicates`, `format:check`, `check:suppressions`, a spec) is answered
#: only inside the file itself.
_SIGNATURE_STEPS = frozenset({"check", "lint", "lint:changed"})


def _owed_signatures(piece: SliceRecord, failure: gates.GateFailure, blamed: list[str]) -> bool:
    """Whether this gate failure says the implementation is unfinished
    rather than that the acceptance tests are broken.

    Block 1 accepted type and type-aware lint errors inside these files
    because the API they call did not exist yet, and recorded them as
    `tests_type_debt`. The same lanes still failing on the same files after
    an implementation turn is that debt unpaid: the signatures the product
    now offers are not the ones the tests call. That is the implementer's
    own diagnostic and an ordinary correction - the fix is in the product
    code, and the test bytes never have to move. Any other step, or a file
    block 1 recorded no debt for, stays block 1's defect."""
    if not failure.steps & _SIGNATURE_STEPS:
        return False
    return all(name in piece.tests_type_debt for name in blamed)


def _gate_rejection(piece: SliceRecord, failure: gates.GateFailure) -> str:
    """The diagnostic a repairable gate failure corrects from: the gate's
    own output, and around it the two things an implementer cannot read off
    it - which of the blamed files are not its to repair, and which are not
    its to touch. An unpaid signature debt gets the tsc/eslint lines with
    the one thing the implementer has to understand about them said
    first."""
    blame = _blame(failure, piece.test_files) if failure.located else _Blame([], [])
    return "\n".join(
        part
        for part in (
            _unpaid_signature_debt(piece, failure, blame),
            failure.diagnostic,
            _block_one_share(piece, failure, blame),
            _outside_this_layer(piece, failure),
        )
        if part
    )


def _unpaid_signature_debt(piece: SliceRecord, failure: gates.GateFailure, blame: _Blame) -> str:
    """Said first when the whole failure is block 1's recorded type debt
    coming back unpaid: the fix is in the product code and the test bytes
    are right."""
    if blame.others or not blame.acceptance:
        return ""
    if not _owed_signatures(piece, failure, blame.acceptance):
        return ""
    return (
        f"the type and lint lanes still fail inside {', '.join(blame.acceptance)}: the "
        "acceptance tests call signatures the implementation does not provide yet. Add or "
        "widen them in the product code - the test bytes are immutable and correct."
    )


def _block_one_share(piece: SliceRecord, failure: gates.GateFailure, blame: _Blame) -> str:
    """Which part of a mixed failure belongs to block 1. Without it the
    implementer reads one verdict and cannot tell the half it can fix from
    the half whose bytes are frozen, so it either rewrites a test it may not
    touch or exhausts its budget trying (#422)."""
    if not blame.others:
        return ""
    theirs = [name for name in blame.acceptance if not _owed_signatures(piece, failure, [name])]
    if not theirs:
        return ""
    return (
        f"these are block 1's acceptance tests, not yours - their bytes are immutable and no "
        f"turn of yours may repair them: {', '.join(theirs)}. Fix everything else the gate "
        "named; if they are all that is left failing, the driver stops the run as "
        "TESTS_INVALID and block 1 repairs them."
    )


def _outside_this_layer(piece: SliceRecord, failure: gates.GateFailure) -> str:
    """The blamed files this slice's layer forbids, gathered under one
    heading with the gate's own lines about them.

    The gate sizes its steps from the tree, not from the slice, so it
    routinely blames a file the scope check would reject the turn for
    touching: #422's domain slice was handed six svelte-check errors in two
    UI files, told nothing about them, and then rejected on scope for the
    turn that went and fixed them - two contradictory instructions across
    two turns. This decides nothing new; `scope_breach` still says what is
    out of reach, and this only reads the same rule over the culprits the
    gate produced - including its one widening, so the store and the domain
    modules a dependent ui slice was briefed to adopt are never headed as
    off-limits to the slice whose own work they are."""
    adopts_domain = _adopts_domain(piece)
    outside = sorted(
        name
        for name in failure.culprits
        if layers.rejects_for_layer(piece.layer, name, adopts_domain) is not None
    )
    if not outside:
        return ""
    blamed = [
        line.strip()
        for line in failure.diagnostic.splitlines()
        if any(name in line for name in outside)
    ]
    return "\n".join(
        [
            f"these files are outside your layer ({piece.layer}) - do not edit them; if the "
            "failure is theirs, say so in your summary and keep your own files green:",
            *(f"  {line}" for line in blamed or outside),
        ]
    )


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


def _diff_base(piece: SliceRecord, fix_turn: bool) -> str:
    """The commit this turn's diff is measured from. A fix turn records its
    own base when it launches, so a resume days later judges the reply
    against the same commit the agent wrote it against, whatever has moved
    on the slice since; every other turn is measured from the failing-test
    commit it started on."""
    if fix_turn and piece.turns:
        return piece.turns[-1].get("diff_base") or piece.failing_sha
    return piece.failing_sha


def _changed_nothing(piece: SliceRecord, path) -> str | None:
    """A fix turn's own first question, asked before any gate runs: did this
    turn change anything at all? The answer is the tree against the freeze
    commit the request started from - dirty, or a HEAD past it - and not the
    accumulated diff `_diff_base` measures, which by design still carries
    everything block 3 committed (#451) and so says "changed" of a turn that
    typed nothing (#422 run 5: a 42-second reply, a clean tree, and the
    driver freezing it again).

    Returns the diagnostic when nothing moved, None when something did. An
    unreadable status counts as changed: `is_clean` says clean only when git
    said so, and a rejection is not something to invent out of silence."""
    if not worktrees.is_clean(path):
        return None
    if worktrees.local_head(path) != piece.frozen_commit:
        return None
    return (
        "the fix turn changed nothing: the working tree and HEAD match the frozen commit "
        f"{piece.frozen_commit}"
    )


def _check_worktree_state(
    record: RunRecord, piece: SliceRecord, path, frozen_ok: bool = False, base: str = ""
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
    ref = base or piece.failing_sha
    if head == ref:
        changed = worktrees.changed_since(path, ref)
    else:
        changed = worktrees.changed_between(path, ref)
    return changed or None


def _check_reply_structure(record: RunRecord, piece: SliceRecord, reply: object) -> None:
    """The reply's shape, and only its shape. `objection` carries null when
    the agent has none - the schema lists every property in `required`,
    because aarmy's strict subset demands it - and an absent key means the
    same thing. Its own contents are not judged here: a malformed objection
    is an ordinary rejected attempt (steps/objection.py), never a stop, and
    a reply that carries a real one may leave `changed_files` empty -
    rejecting the tests is exactly the case where there is nothing honest to
    change."""
    required = {"changed_files", "summary"}
    if not isinstance(reply, dict) or not required <= set(reply) <= required | {"objection"}:
        raise _contract(
            record,
            piece,
            "reply must have exactly changed_files and summary, and at most an objection "
            "beside them",
        )
    files = reply["changed_files"]
    if not isinstance(files, list) or any(
        not isinstance(item, str) or not item.strip() for item in files
    ):
        raise _contract(record, piece, "changed_files must be an array of paths")
    if not files and reply.get("objection") is None:
        raise _contract(record, piece, "changed_files must be a non-empty array of paths")
    if not isinstance(reply["summary"], str) or not reply["summary"].strip():
        raise _contract(record, piece, "summary must be a non-empty string")


def _correct_report(record: RunRecord, piece: SliceRecord, reply: dict, changed: list[str]) -> None:
    """The reply's account of the diff, put right from the diff itself.

    Nothing the driver trusts comes from the report: scope, the layer
    boundary, acceptance immutability and the gates have all just run on
    the real diff and passed on it. So once they are green a divergent list
    is bookkeeping and nothing else - the diff is the truth, the record
    takes it, and the turn keeps the attempt it would otherwise have spent
    being told something the driver already knows. #420 run 3 ended a whole
    run on one, on a list that was right and a diff the driver had read
    wrong. A mismatch beside a failing gate never reaches here: that turn is
    rejected on the gate, which is what it must answer."""
    mismatch = _report_mismatch(reply["changed_files"], changed)
    if mismatch is None:
        return
    with record.transition():
        reply["changed_files"] = list(changed)
        retained = piece.turns[-1].get("reply") if piece.turns else None
        if isinstance(retained, dict):
            retained["changed_files"] = list(changed)
        if piece.turns:
            piece.turns[-1]["reported_files_corrected"] = mismatch
        record.save()
    narrate.headed(
        f"📝 #{piece.number} ({piece.layer}) reported files corrected from the diff: ", mismatch
    )


def _report_mismatch(reported: list[str], changed: list[str]) -> str | None:
    """How the reply's list diverges from the actual diff, or None when
    they agree: the paths the diff touched and the reply left out, and the
    paths the reply named and the diff never touched."""
    if set(reported) == set(changed):
        return None
    unreported = sorted(set(changed) - set(reported))
    phantom = sorted(set(reported) - set(changed))
    return "; ".join(
        f"{name} {', '.join(paths)}"
        for name, paths in (("unreported", unreported), ("phantom", phantom))
        if paths
    )


def _check_scope(piece: SliceRecord, changed: list[str]) -> _Rejection | None:
    """The paths this slice may not touch: the files that judge the work,
    and the other layer's. A breach, but a recoverable one - the agent is
    told exactly which paths to put back and gets its ordinary corrections
    to do it, because a turn that is right about the story and wrong about
    one file is worth one more turn, not a dead run (#337)."""
    breach = scope_breach(piece, changed)
    if breach is None:
        return None
    return _Rejection(
        f"{breach} — those paths are outside this slice's reach. Put every one of "
        "them back exactly as it was (`git checkout -- <path>` for a file you "
        "modified, delete a file you added) and leave the rest of your "
        "implementation in place. If the story genuinely needs one of those "
        "changes, revert it anyway and say so in your summary: this turn may "
        "never carry it.",
        breach,
    )


def scope_breach(piece: SliceRecord, changed: list[str]) -> str | None:
    """Why this diff reaches outside the slice, or None when every path
    belongs. `_check_scope` turns that verdict into a corrective rejection;
    the objection check needs the verdict alone, because an objection left
    beside work outside the slice is not one the driver will carry."""
    reasons = [reason for reason in map(_out_of_reach(piece), changed) if reason is not None]
    return "; ".join(reasons) or None


def _out_of_reach(piece: SliceRecord):
    """Why one changed path is outside this slice, or None when it belongs.

    A dependent ui slice runs on a tree that already carries its domain
    sibling and was briefed to adopt that sibling's new API at the call
    sites, so the store and the domain areas are inside its reach; every
    other slice is judged by its layer alone. Nothing widens the forbidden
    files and prefixes - the gates stay out of reach of every slice."""
    adopts_domain = _adopts_domain(piece)

    def reason(changed_file: str) -> str | None:
        basename = PurePosixPath(changed_file).name
        if not layers.permits_gate_file(piece.layer, changed_file) and (
            changed_file.startswith(_FORBIDDEN_PREFIXES)
            or basename in _FORBIDDEN_FILES
            or basename.endswith((".snap", ".lock"))
        ):
            return f"forbidden file changed: {changed_file}"
        return layers.rejects_for_layer(piece.layer, changed_file, adopts_domain)

    return reason


def _adopts_domain(piece: SliceRecord) -> bool:
    """Whether this slice adopts its domain sibling's API: the ui slice the
    driver runs after the domain slice, on a merge of its frozen commit."""
    return piece.layer == "ui" and piece.depends_on == "domain"


def _check_acceptance_unchanged(
    record: RunRecord, piece: SliceRecord, path, changed: list[str]
) -> None:
    """Removing, skipping, weakening or replacing the retained acceptance
    tests is a contract failure - their bytes must be untouched."""
    for test_file in piece.test_files:
        if test_file not in changed:
            continue
        recorded = worktrees.content_at(path, piece.acceptance_sha, test_file)
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
    rerun while its sibling corrects or escalates.

    A clean worktree already sitting on this slice's frozen commit has
    nothing to commit and keeps the sha it has: there is no second commit to
    make, and asking git for one is how #422 run 5 ended - `git commit`
    exiting 1 on an empty tree, under a pre-commit hook's passing output.
    A fix turn cannot reach here that way any more (`_changed_nothing`
    rejects it first); this keeps any later caller from it too."""
    path = worktrees.slice_worktree_path(piece.slug)
    if _already_frozen(piece, path):
        sha = piece.frozen_commit
    else:
        sha = worktrees.commit_all(path, f"feat: implement {piece.layer} slice for #{piece.number}")
    with record.transition():
        piece.implementation_sha = sha
        piece.frozen_commit = sha
        piece.move("succeeded")
        record.save()
    narrate.line(f"🔒 #{piece.number} ({piece.layer}) frozen at {sha[:12]}")


def _already_frozen(piece: SliceRecord, path) -> bool:
    """The worktree is clean and its HEAD is this slice's frozen commit, so
    there is nothing left for a freeze to commit. False before the first
    freeze, where `frozen_commit` is empty and no HEAD can equal it."""
    return bool(piece.frozen_commit) and (
        worktrees.local_head(path) == piece.frozen_commit and worktrees.is_clean(path)
    )


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
