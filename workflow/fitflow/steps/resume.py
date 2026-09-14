"""Box: resume - reconcile the retained record with what the run left
behind, and say where the flow continues.

A resumed run replays nothing: every slice goes back to the point its last
turn actually reached. A turn that ended with a valid reply has its
verdict re-derived from that reply and the worktree it left - the same
bytes, proven by the digest recorded when the turn ended, and no new agent
call - so a run stopped by a driver defect continues once the driver is
fixed. The exception is a turn the loop stopped early on because its
diagnostic repeated verbatim: on an unchanged tree that re-derivation
could only reach the same diagnostic, so the run stays stopped and says
so. A turn the driver never saw end, or one that failed before it
produced a reply, is voided and relaunched under the same attempt number:
counters are not reset, the ledger keeps the voided entry, and a turn
still running on this machine is never relaunched beside. A slice with no
accepted assignment sends the run back to block 2.

A slice interrupted inside one of block 4's fix turns is reconciled the
same way, and goes back to `fixing`: the run continues in block 4, where
the fix request finishes its remaining attempts - re-judging the retained
reply on the bytes it left, or relaunching the turn the driver never saw
end - before the join is re-verified and the new commit carried onto the
integration branch.

A slice parked in `tests_rejected` is waiting on block 1, not on a turn of
its own: it stays parked, its unfinished repair turn is voided like any
other, and block 3 relaunches the repair from a fresh repair worktree.
"""

from fitflow import agents, audit, github, narrate, settings, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord
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
        f"relaunching block 1's repair"
    )


def _require_repair_not_in_flight(record: RunRecord, piece: SliceRecord) -> None:
    if agents.turn_in_flight(objection.repair_team(piece), "mechanic"):
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
    `fixing`, carrying what its last turn actually reached: a reply to
    re-judge on the bytes it left, or a voided turn for the fix request to
    relaunch under the same attempt. The request's own budget is what block
    4 continues against, so a resume buys no extra attempt."""
    last = piece.turns[-1]
    note = f"re-judging fix attempt {last.get('fix_attempt', 1)} from its retained reply"
    if last["status"] == "running":
        _require_not_in_flight(record, piece)
        _mark_void(record, piece, last, "the driver stopped while the fix turn was running")
        note = f"fix attempt {last.get('fix_attempt', 1)} voided; it will be relaunched"
    elif last["result"] == "void":
        note = f"relaunching voided fix attempt {last.get('fix_attempt', 1)}"
    elif last.get("reply") is None:
        _mark_void(record, piece, last, last["why"] or "the fix turn produced no valid reply")
        note = f"fix attempt {last.get('fix_attempt', 1)} left no reply; it will be relaunched"
    else:
        _require_can_be_rejudged(record, piece, last)
    with record.transition():
        piece.resume_to("fixing")
        record.save()
    narrate.line(f"♻️  #{piece.number} ({piece.layer}) stopped in a review fix: {note}")


def _require_not_in_flight(record: RunRecord, piece: SliceRecord) -> None:
    if agents.turn_in_flight(piece.team, piece.role):
        raise FlowFailure(
            Outcome.EXECUTION_HELD,
            f"{piece.slug}: a {piece.role} turn is still running on this machine; "
            "wait for it to end, or stop it, before resuming",
            record.story_number,
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
    _require_not_stopped_for_repetition(record, piece, last)


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
