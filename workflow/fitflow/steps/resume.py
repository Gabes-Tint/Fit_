"""Box: resume - reconcile the retained record with what the run left
behind, and say where the flow continues.

A resumed run replays nothing: every slice goes back to the point its last
turn actually reached. A turn that ended with a valid reply and no verdict
has that verdict re-derived from the reply and the worktree it left - the
same bytes, proven by the digest recorded when the turn ended, and no new
agent call - so a run stopped by a driver defect continues once the driver
is fixed. A turn the driver already judged is the opposite case: its
diagnostic is on the ledger, and re-deriving it on bytes that have not
moved could only reach it again, so block 3 relaunches the implementer one
attempt further on - with one grace attempt when the budget is spent,
because the verdict that spent it was the driver's own. A turn the loop
stopped early on because its diagnostic repeated verbatim is neither
re-judged nor relaunched: the run stays stopped and says so. A turn the
driver never saw end, or one that failed before it produced a reply, is
voided and relaunched under the same attempt number: counters are not
reset, the ledger keeps the voided entry, and a turn still running on this
machine is never relaunched beside. A slice with no accepted assignment
sends the run back to block 2.

A slice interrupted inside one of block 4's fix turns is reconciled the
same way, and goes back to `fixing`: the run continues in block 4, where
the fix request finishes its remaining attempts - re-judging the retained
reply on the bytes it left, or relaunching the turn the driver never saw
end - before the join is re-verified and the new commit carried onto the
integration branch. A fix turn already recorded as failed is the one thing
never re-judged: its verdict is on the ledger, the bytes have not moved,
and re-deriving it could only reach it again, so block 4 relaunches that
turn instead.

A slice parked in `tests_rejected` is waiting on block 1, not on a turn of
its own: it stays parked, its unfinished repair turn is voided like any
other, and block 3 relaunches the repair from a fresh repair worktree.
"""

from fitflow import agents, audit, github, narrate, settings, turns, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord, judged_failed, judged_rejected
from fitflow.steps import objection

# Where a resumed run continues, in flow order.
DELEGATE = "delegate"
IMPLEMENT = "implement"
DELIVER = "deliver"
SHIP = "ship"


def reconcile(story, record: RunRecord) -> str:
    """The stage to continue from, after every slice is put back where its
    last turn left it. Raises when nothing can honestly continue."""
    narrate.line(
        f"♻️  Resuming #{story.number} from its retained run "
        f"(terminal: {record.terminal or '(none: interrupted)'})"
    )
    if record.terminal == "SHIPPED":
        raise FlowFailure(
            Outcome.CANNOT_PICK, f"#{story.number} already shipped; nothing to resume"
        )
    if _pr_merged(record):
        _take_back(story)
        return SHIP
    if story.state != "OPEN":
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{story.number} is {story.state.lower()}")
    _take_back(story)
    if any(not piece.assignments for piece in record.ordered()):
        _require_never_launched(record)
        narrate.line("♻️  No slice has an accepted assignment: continuing at block 2")
        return DELEGATE
    for piece in record.ordered():
        _reconcile_slice(record, piece)
    return _after_block3(record)


def _take_back(story) -> None:
    """The story is this run's again: `blocked` was the stopped run's mark,
    and `in-progress` holds it off the pick list while this one works."""
    if settings.BLOCKED_LABEL in story.labels:
        github.remove_label(story.number, settings.BLOCKED_LABEL)
        narrate.line(f"✏️  #{story.number} label {settings.BLOCKED_LABEL} removed")
    if settings.IN_PROGRESS_LABEL not in story.labels:
        github.add_label(story.number, settings.IN_PROGRESS_LABEL)
        narrate.line(f"✏️  #{story.number} labelled {settings.IN_PROGRESS_LABEL}")
    audit.held()


def _pr_merged(record: RunRecord) -> bool:
    pr_number = record.delivery.get("pr_number")
    if not pr_number:
        return False
    state = github.view_pr(int(pr_number)).state
    if state == "MERGED":
        narrate.line(f"♻️  PR #{pr_number} is merged: continuing at block 5")
        return True
    if state != "OPEN":
        raise FlowFailure(
            Outcome.RUN_STATE_CONFLICT,
            f"PR #{pr_number} is {state}, neither open nor merged; audit it, then "
            f"`go.py {record.story_number} --reset`",
            record.story_number,
        )
    return False


def _after_block3(record: RunRecord) -> str:
    unfinished = [piece for piece in record.ordered() if piece.state != "succeeded"]
    if unfinished and all(piece.state == "fixing" for piece in unfinished):
        narrate.line("♻️  A block 4 fix was interrupted: continuing at block 4")
        return DELIVER
    if unfinished:
        return IMPLEMENT
    if record.terminal == "IMPLEMENTED":
        narrate.line("♻️  Every slice is frozen and reported: continuing at block 4")
        return DELIVER
    narrate.line("♻️  Every slice is frozen: continuing at block 3's report")
    return IMPLEMENT


def _require_never_launched(record: RunRecord) -> None:
    for piece in record.ordered():
        if piece.turns:
            raise FlowFailure(
                Outcome.RUN_STATE_CONFLICT,
                f"{piece.slug} has turns but no accepted assignment; audit the record, "
                f"then `go.py {record.story_number} --reset`",
                record.story_number,
            )


def _reconcile_slice(record: RunRecord, piece: SliceRecord) -> None:
    if piece.state == "succeeded":
        return
    if piece.state == "tests_rejected":
        _reopen_test_repair(record, piece)
        return
    if piece.state == "escalating":
        raise _conflict(record, piece, "was interrupted between two roles")
    if _in_review_fix(piece):
        _reopen_review_fix(record, piece)
        return
    if not piece.turns:
        _never_launched(record, piece)
        return
    _reconcile_turn(record, piece, piece.turns[-1])


def _reconcile_turn(record: RunRecord, piece: SliceRecord, last: dict) -> None:
    if last["status"] == "running":
        _require_not_in_flight(record, piece)
        _void(record, piece, last, "the driver stopped while the turn was running")
    elif last["result"] == "void":
        _back_to_launch(record, piece, "its voided attempt")
    elif _already_judged(piece, last):
        _reopen_judged(record, piece, last)
    elif last.get("reply") is not None:
        _reopen_for_validation(record, piece, last)
    else:
        _void(record, piece, last, last["why"] or "the turn produced no valid reply")


def _reopen_test_repair(record: RunRecord, piece: SliceRecord) -> None:
    """The slice stays where block 1 has it: block 3 relaunches the repair.
    A repair turn the driver never saw end is voided first, and one still
    running on this machine is never relaunched beside."""
    _require_repair_not_in_flight(record, piece)
    voided = objection.void_unfinished_repair(record, piece)
    with record.transition():
        piece.resume_to("tests_rejected")
        record.save()
    note = f", {voided} voided" if voided else ""
    narrate.line(
        f"♻️  #{piece.number} ({piece.layer}) rejected the acceptance tests{note}: "
        f"relaunching block 1's repair ({objection.repair_role(piece)})"
    )


def _require_repair_not_in_flight(record: RunRecord, piece: SliceRecord) -> None:
    team, role = objection.repair_team(piece), objection.repair_role(piece)
    if _live_turn(record, piece, team, role):
        raise FlowFailure(
            Outcome.EXECUTION_HELD,
            f"{piece.slug}: a test repair turn is still running on this machine; "
            "wait for it to end, or stop it, before resuming",
            record.story_number,
        )


def _never_launched(record: RunRecord, piece: SliceRecord) -> None:
    """Failed before any launch (the launch barrier): back to the launch."""
    with record.transition():
        piece.resume_to("assigned")
        record.save()
    narrate.line(f"♻️  #{piece.number} ({piece.layer}) never launched: back to assigned")


def _in_review_fix(piece: SliceRecord) -> bool:
    return piece.state == "fixing" or bool(piece.turns and piece.turns[-1]["kind"] == "review_fix")


def _reopen_review_fix(record: RunRecord, piece: SliceRecord) -> None:
    """A slice stopped inside one of block 4's fix turns goes back to
    `fixing`, carrying what its last turn actually reached: a reply with no
    verdict to re-judge on the bytes it left, a voided turn for the fix
    request to relaunch under the same attempt, or a turn already judged
    failed, which block 4 relaunches one attempt further on. The request's
    own budget is what block 4 continues against, so a resume buys no extra
    attempt - except the single grace attempt a spent budget earns when the
    verdict that spent it was the driver's own."""
    last = piece.turns[-1]
    attempt = last.get("fix_attempt", 1)
    note = f"re-judging fix attempt {attempt} from its retained reply"
    if last["status"] == "running":
        _require_not_in_flight(record, piece)
        _mark_void(record, piece, last, "the driver stopped while the fix turn was running")
        note = f"fix attempt {attempt} voided; it will be relaunched"
    elif last["result"] == "void":
        note = f"relaunching voided fix attempt {attempt}"
    elif last.get("reply") is None:
        _mark_void(record, piece, last, last["why"] or "the fix turn produced no valid reply")
        note = f"fix attempt {attempt} left no reply; it will be relaunched"
    elif judged_failed(last):
        _require_not_stopped_for_repetition(record, piece, last)
        note = f"fix attempt {attempt} was judged failed; it will be relaunched, not re-judged"
    else:
        _require_can_be_rejudged(record, piece, last)
    with record.transition():
        piece.resume_to("fixing")
        record.save()
    narrate.line(f"♻️  #{piece.number} ({piece.layer}) stopped in a review fix: {note}")


def _live_turn(record: RunRecord, piece: SliceRecord, team: str, role: str) -> bool:
    """Whether a turn is still running, from one pgrep answer; an answer
    pgrep could not give stops the resume rather than reading as none."""
    state, reason = agents.turn_liveness(team, role)
    if state is None:
        raise FlowFailure(
            Outcome.RUN_STATE_CONFLICT,
            f"{piece.slug}: could not tell whether a {role} turn is still running "
            f"on this machine ({reason}); check for a live turn by hand, then run --reset",
            record.story_number,
        )
    return state


def _require_not_in_flight(record: RunRecord, piece: SliceRecord) -> None:
    if _live_turn(record, piece, piece.team, piece.role):
        raise FlowFailure(
            Outcome.EXECUTION_HELD,
            f"{piece.slug}: a {piece.role} turn is still running on this machine; "
            "wait for it to end, or stop it, before resuming",
            record.story_number,
        )


def _already_judged(piece: SliceRecord, last: dict) -> bool:
    """Whether the driver's own verdict on this turn is already recorded:
    a diagnostic against the attempt the slice's current role is on. A turn
    of a role the slice has since escalated past is not that - the
    escalation reset the counters and the slice stands at the new role's
    launch, not at this turn's."""
    return (
        judged_rejected(last)
        and (last["role"], last["revision"]) == (piece.role, piece.revision)
        and last["attempt"] == piece.attempts
    )


def _reopen_judged(record: RunRecord, piece: SliceRecord, last: dict) -> None:
    """A turn the driver already judged is answered by another turn, never
    re-judged: the verdict sits on the ledger beside the diagnostic the
    next turn is corrected from, and the bytes have not moved, so
    re-deriving it could only reach it again. #337 run 4 spent an entire
    resume doing exactly that - re-validating the attempt the stopped run
    had already rejected, and stopping on the same diagnostic without one
    agent turn in it.

    A budget with nothing left still buys exactly one grace attempt, as a
    block 4 fix request's does: the run is being resumed because the driver
    was fixed, and the verdict that spent the last attempt was the driver's
    own. It is granted once, and recorded, so a second resume stops
    instead."""
    _require_worktree_unmoved(record, piece, last)
    _require_not_stopped_for_repetition(record, piece, last)
    attempt = last["attempt"]
    spent = attempt >= turns.BUDGET
    if spent:
        _require_grace_unspent(record, piece)
    narrate.line(
        f"♻️  #{piece.number} ({piece.layer}) {piece.role} attempt {attempt} was judged "
        f"failed; it will be relaunched, not re-judged"
    )
    if spent:
        _grant_grace(record, piece)
    with record.transition():
        piece.resume_to("correcting")
        record.save()


def _require_grace_unspent(record: RunRecord, piece: SliceRecord) -> None:
    """The grace attempt is one, not one per resume: a slice that has
    already had it and failed again is exhausted, and the call is a
    human's."""
    if piece.grace_granted:
        raise _conflict(
            record,
            piece,
            f"has spent its {turns.BUDGET} {piece.role} attempts and the one grace attempt "
            f"past them",
        )


def _grant_grace(record: RunRecord, piece: SliceRecord) -> None:
    with record.transition():
        piece.grace_granted = True
        record.save()
    narrate.line(
        f"♻️  #{piece.number} ({piece.layer}) has spent its {turns.BUDGET} attempts: "
        "granting one grace attempt after a driver-side rejection"
    )


def _reopen_for_validation(record: RunRecord, piece: SliceRecord, last: dict) -> None:
    """A turn that ended with a valid reply is judged again, on the bytes
    it left; bytes that moved since are not that turn's work."""
    _require_can_be_rejudged(record, piece, last)
    with record.transition():
        piece.resume_to("running")
        record.save()


def _require_can_be_rejudged(record: RunRecord, piece: SliceRecord, last: dict) -> None:
    """What a retained reply must satisfy before its verdict is re-derived:
    the worktree still there, its bytes exactly the ones the turn left, and
    a verdict that is not already known to repeat."""
    _require_worktree_unmoved(record, piece, last)
    _require_not_stopped_for_repetition(record, piece, last)


def _require_worktree_unmoved(record: RunRecord, piece: SliceRecord, last: dict) -> None:
    """The worktree the turn left, still there and still holding exactly
    the bytes it left. A tree edited by hand since is not what the record
    describes - neither the work a retained reply is judged on nor the
    accumulated work a relaunch continues from."""
    path = worktrees.slice_worktree_path(piece.slug)
    if not path.exists():
        raise _conflict(record, piece, "worktree is missing")
    digest = worktrees.working_tree_digest(path)
    if last.get("digest") and digest != last["digest"]:
        raise _conflict(
            record,
            piece,
            f"worktree changed since {piece.role} attempt {last['attempt']} ended; "
            "audit it, then reset",
        )


def _require_not_stopped_for_repetition(record: RunRecord, piece: SliceRecord, last: dict) -> None:
    """A turn the loop stopped on because its diagnostic came back
    identical is not re-validated on an unchanged tree: the verdict is a
    function of these bytes, so resuming would reach the same diagnostic
    and stop again on it. A tree that moved since is the one thing that
    makes re-validating worth doing, and the digest check above is what
    sees it."""
    if not last.get("repeated"):
        return
    raise _conflict(
        record,
        piece,
        f"was stopped early: {piece.role} attempt {last['attempt']} failed exactly as "
        f"attempt {last['attempt'] - 1} ({last.get('diagnostic', '')}), and nothing in the "
        f"worktree has changed since, so re-validating it would only reach the same "
        f"diagnostic",
    )


def _void(record: RunRecord, piece: SliceRecord, last: dict, why: str) -> None:
    """The ledger keeps the entry, marked void; the attempt number is
    reserved again by the relaunch."""
    _mark_void(record, piece, last, why)
    _back_to_launch(record, piece, f"attempt {last['attempt']} voided ({why})")


def _mark_void(record: RunRecord, piece: SliceRecord, last: dict, why: str) -> None:
    with record.transition():
        last["status"] = "completed"
        last["result"] = "void"
        last["why"] = f"voided on resume: {why}"
        piece.attempts = max(0, piece.attempts - 1)
        record.save()


def _back_to_launch(record: RunRecord, piece: SliceRecord, note: str) -> None:
    state = "correcting" if piece.attempts > 0 else "assigned"
    with record.transition():
        piece.resume_to(state)
        record.save()
    narrate.line(
        f"♻️  #{piece.number} ({piece.layer}) {note}: relaunching {piece.role} "
        f"attempt {piece.attempts + 1}"
    )


def _conflict(record: RunRecord, piece: SliceRecord, why: str) -> FlowFailure:
    return FlowFailure(
        Outcome.RUN_STATE_CONFLICT,
        f"{piece.slug} {why}; audit it, then `go.py {record.story_number} --reset`",
        record.story_number,
    )
