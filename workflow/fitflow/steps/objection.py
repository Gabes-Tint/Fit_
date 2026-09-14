"""Box: the implementer rejects the acceptance tests, and block 1 repairs
them - block 3's one edge back into block 1.

Block 1's tests are immutable inputs to implementation, and that is the
point: an implementer may not weaken what judges it. But immutable is not
the same as correct. On #337 the mechanic wrote four playwright
expectations over one shared `beforeEach` that fakes the search endpoint as
`[candy, apple]`: test 1 wants the apple `.first()`, tests 2 and 4 want the
candy `.first()`, test 3 wants the apple `.nth(1)`. No honest application
change passes all four. The solver said exactly that, three times, with two
concrete repairs, and refused to game the locators; the driver had no
channel for the objection, spent the whole budget and misfiled the stop as
CAPACITY_EXHAUSTED.

So a reply may now carry an `objection`: the kind, the acceptance tests it
names, why no honest change in this slice's layer can make them pass
together, and the repair it proposes. The driver never takes that on trust.
It checks that the named files really are this slice's retained acceptance
tests, that the acceptance run on the turn's own working tree still fails on
at least one of them, that the tree carries no commit and nothing outside
this slice's reach, and that the objection says something. A malformed or
unverifiable objection is an ordinary failed attempt and costs the turn's
place in the budget; a verified one costs only the turn.

A verified objection parks the slice in `tests_rejected` and sends the tests
back to block 1's writer as a correction turn, in a repair worktree of the
driver's own based on the slice's failing-test base, under block 1's usual
validation: test files only, the right kind, the repository's gates, and a
failure on an expectation rather than a throw. The repaired commit is merged
into the slice branch - which still holds the implementer's uncommitted work
- pushed, and re-frozen: `tests_sha` becomes the repair commit and
`failing_sha` the merge. The slice then returns to `assigned` with the same
role, revision, assignment, session and worktree and a fresh attempt
counter, because the tests it is judged by are new inputs.

At most two repairs per slice. A third verified objection stops the run as
TESTS_INVALID with every objection in the message, because at that point the
acceptance tests, not the implementer, are what this run cannot get past.
"""

from collections.abc import Callable
from pathlib import Path

from fitflow import acceptance, agents, audit, github, narrate, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord
from fitflow.steps import failing_tests

KINDS = ("tests_contradict", "tests_out_of_layer", "tests_wrong")
_FIELDS = frozenset({"kind", "tests", "why", "proposed_fix"})
_REQUIRED = frozenset({"kind", "tests", "why"})
# Two repairs per slice, two mechanic turns per repair: the tests get the
# same shape of bounded budget the implementation does, and no more.
MAX_REPAIRS = 2
REPAIR_TURNS = 2

ScopeBreach = Callable[[SliceRecord, list[str]], str | None]


class Objected(Exception):  # noqa: N818 - a control-flow word, not an error
    """Not a failure: the turn ended with an objection the driver verified,
    so the slice is parked in `tests_rejected` and block 3 calls `repair()`
    instead of judging the turn any further."""


def brief() -> str:
    """What the implementer's brief says about objecting, rendered from the
    same constants the verification reads, so the rule the agent is told and
    the rule it is judged by cannot drift."""
    return "\n".join(
        [
            "Reject the acceptance tests only when no honest change inside this slice's "
            "layer can make the tests you name pass together - they contradict each "
            f"other (`{KINDS[0]}`), they assert behavior that belongs to another layer "
            f"and cannot be observed from this one (`{KINDS[1]}`), or they are simply "
            f"wrong about the product (`{KINDS[2]}`).",
            "",
            "It is never a way to skip work, and the driver checks it: the files you "
            "name must be this slice's own acceptance tests, they must still fail on "
            "your working tree, and that tree must carry no commit and nothing outside "
            "this slice. An objection that fails any of those is an ordinary rejected "
            "attempt and costs you one of your three.",
            "",
            "A verified objection sends the tests back to the mechanic who wrote them, "
            "with your reason and your proposed fix, and you get a fresh set of "
            "attempts against the repaired tests. Say what is wrong precisely enough "
            "for someone else to repair it, and gaming the tests is never the answer: "
            "when your objection stands, say so and object.",
        ]
    )


# --- verifying one objection ---------------------------------------------------


def consider(
    record: RunRecord, piece: SliceRecord, reply: dict, scope_breach: ScopeBreach
) -> str | None:
    """The single call block 3's `_settle` makes before it judges a turn the
    ordinary way. None when the reply carries no objection; the diagnostic
    to correct from when it carries one the driver refuses; and `Objected`
    - not a return - when the objection verifies."""
    raw = reply.get("objection")
    if raw is None:
        return None
    with record.transition():
        piece.move("validating")
        record.save()
    narrate.line(f"📦 Validating #{piece.number} ({piece.layer}) objection to the tests")
    refusal = _refusal(record, piece, raw, scope_breach)
    if refusal is not None:
        return (
            f"your objection to the acceptance tests was refused: {refusal}. "
            "Object only when the driver can verify it; otherwise implement the slice."
        )
    _accept(record, piece, raw)
    raise Objected


def _refusal(
    record: RunRecord, piece: SliceRecord, raw: object, scope_breach: ScopeBreach
) -> str | None:
    """The first verification condition that fails, or None when the
    objection stands. Ordered cheapest first: the reply's own shape, then
    what it names, then the worktree, and only then the test run."""
    path = worktrees.slice_worktree_path(piece.slug)
    checks = (
        lambda: _malformed(raw),
        lambda: _not_this_slice(piece, raw),
        lambda: _tree_refusal(piece, path, scope_breach),
        lambda: _already_passing(record, piece, path, raw),
    )
    for check in checks:
        refusal = check()
        if refusal is not None:
            return refusal
    return None


def _malformed(raw: object) -> str | None:
    if not isinstance(raw, dict) or not _REQUIRED <= set(raw) <= _FIELDS:
        return (
            "objection must be an object with kind, tests and why, and at most a "
            "proposed_fix beside them"
        )
    if raw["kind"] not in KINDS:
        return f"objection kind must be one of {', '.join(KINDS)}, not {raw['kind']!r}"
    return _malformed_body(raw)


def _malformed_body(raw: dict) -> str | None:
    tests = raw["tests"]
    if not isinstance(tests, list) or not tests or not all(_is_text(item) for item in tests):
        return "objection.tests must be a non-empty array of acceptance test paths"
    if not _is_text(raw["why"]):
        return (
            "objection.why must say in words why no honest change in this slice's layer "
            "can make those tests pass together"
        )
    return None


def _is_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _not_this_slice(piece: SliceRecord, raw: dict) -> str | None:
    """Only this slice's own retained acceptance tests can be sent back to
    block 1: anything else is a file the objection has no standing over."""
    stranger = sorted(set(raw["tests"]) - set(piece.test_files))
    if not stranger:
        return None
    return (
        f"{', '.join(stranger)} is not a retained acceptance test of this slice; "
        f"this slice's acceptance tests are {', '.join(piece.test_files)}"
    )


def _tree_refusal(piece: SliceRecord, path: Path, scope_breach: ScopeBreach) -> str | None:
    """An objection is judged on the turn's own working tree, so that tree
    must still be one the slice owns: no commit of the agent's own, and
    nothing left outside this slice's reach."""
    head = worktrees.local_head(path)
    if head != piece.failing_sha:
        return (
            f"local HEAD moved to {head[:7]} — an objection is judged on the turn's own "
            "working tree, and implementation agents never commit"
        )
    breach = scope_breach(piece, worktrees.changed_since(path, piece.failing_sha))
    if breach is not None:
        return (
            f"{breach} — put those paths back before objecting: an objection is about the "
            "tests, not a place to leave work outside this slice"
        )
    return None


def _already_passing(record: RunRecord, piece: SliceRecord, path: Path, raw: dict) -> str | None:
    """The objection's own premise, re-taken by the driver: the tests it
    names must still fail here. A runner that could not report at all is a
    tooling failure, never a verdict on the objection."""
    named = list(raw["tests"])
    verdict = acceptance.run_and_check_passing(path, named)
    if verdict.ok:
        return (
            f"{', '.join(named)} already pass on this working tree, so there is nothing "
            "for block 1 to repair"
        )
    if not verdict.repairable:
        raise FlowFailure(Outcome.TOOL_FAILED, verdict.why, record.story_number, add_blocked=True)
    narrate.line(f"🧪 {', '.join(named)} → still failing here, as the objection says ✔")
    return None


def _accept(record: RunRecord, piece: SliceRecord, raw: dict) -> None:
    entry = {
        "kind": raw["kind"],
        "tests": list(raw["tests"]),
        "why": raw["why"],
        "proposed_fix": raw.get("proposed_fix", ""),
        "role": piece.role,
        "attempt": piece.attempts,
    }
    _check_repair_budget(record, piece, entry)
    with record.transition():
        piece.objections.append(entry)
        piece.turns[-1]["result"] = "objected"
        piece.turns[-1]["why"] = _first_line(raw["why"])
        piece.move("tests_rejected")
        record.save()
    narrate.headed(
        f"🙅 #{piece.number} ({piece.layer}) {piece.role} rejects the tests: {raw['kind']} — ",
        raw["why"],
    )


def _check_repair_budget(record: RunRecord, piece: SliceRecord, entry: dict) -> None:
    """Two repairs is where the driver stops believing the loop can end.
    The stop names every objection, because by then the acceptance tests -
    not the implementer - are what this run cannot get past."""
    if piece.test_repairs < MAX_REPAIRS:
        return
    rendered = "\n\n".join(_rendered(item) for item in [*piece.objections, entry])
    raise FlowFailure(
        Outcome.TESTS_INVALID,
        f"{piece.slug}: the {piece.role} rejects the acceptance tests again after "
        f"{piece.test_repairs} block 1 repairs, and the driver verified the objection every "
        f"time; these tests are not repairable by this run — repair them by hand and run the "
        f"story again.\n\n{rendered}",
        record.story_number,
        add_blocked=True,
    )


def _rendered(entry: dict) -> str:
    fix = entry.get("proposed_fix") or "(none proposed)"
    return (
        f"Objection ({entry['kind']}) from the {entry['role']} at attempt {entry['attempt']} "
        f"about {', '.join(entry['tests'])}:\n{entry['why']}\nProposed fix: {fix}"
    )


def _first_line(text: str) -> str:
    return text.strip().splitlines()[0]


# --- block 1 repairs the rejected tests ----------------------------------------


def repair(record: RunRecord, piece: SliceRecord) -> None:
    """Block 1's writer repairs the tests it wrote, in a worktree of the
    driver's own, and the driver re-freezes them onto the slice branch. The
    repair worktree is created fresh - a relaunch after a stopped run starts
    from the base, not from what the dead repair left - and removed once the
    repair lands; a repair that fails keeps it standing for audit."""
    number = piece.test_repairs + 1
    narrate.line(
        f"🩹 Repairing #{piece.number} ({piece.layer}) tests in block 1 "
        f"(repair {number}/{MAX_REPAIRS})"
    )
    slug = f"{piece.slug}-tests-{number}"
    path = worktrees.create_repair_worktree(slug, piece.failing_sha)
    audit.worktree_created(slug)
    narrate.line(f"🌿 Worktree {slug} · branch {slug} at {piece.failing_sha[:12]}")
    agents.ensure_fresh_team(slug, path, piece.number)
    test_files, why, debt = _repair_loop(record, piece, slug, path)
    _refreeze(record, piece, path, test_files, why, debt)
    worktrees.remove_slice_worktree(path)
    worktrees.delete_local_branch(slug)
    agents.delete_team(slug)


def _repair_loop(
    record: RunRecord, piece: SliceRecord, slug: str, path: Path
) -> tuple[list[str], str, dict[str, int]]:
    """The repair's own bounded budget, independent of the implementer's: a
    block 1 verdict the mechanic can repair becomes the next turn's
    diagnostic, and the last turn's stops the run. An agent or tool failure
    is not a verdict on the tests and keeps its own name.

    Either stop leaves the slice in `tests_rejected`, which is what it
    honestly is: the tests are still rejected and still unrepaired, so a
    `--resume` relaunches the repair rather than sending the implementer
    back at tests nobody fixed."""
    diagnostic = _rendered(piece.objections[-1])
    for turn in range(1, REPAIR_TURNS + 1):
        narrate.line(
            f"🔧 Mechanic #{piece.number} ({piece.layer}) test repair turn {turn}/{REPAIR_TURNS}"
        )
        try:
            return _repair_turn(record, piece, slug, path, turn, diagnostic)
        except FlowFailure as failure:
            if failure.outcome not in failing_tests.REPAIRABLE_OUTCOMES:
                raise _repair_stopped(record, piece, failure.outcome, failure.why) from failure
            if turn == REPAIR_TURNS:
                raise _repair_stopped(
                    record,
                    piece,
                    Outcome.TESTS_INVALID,
                    f"block 1 could not repair the acceptance tests the {piece.role} rejected "
                    f"in {REPAIR_TURNS} turns ({failure.outcome.name}: {failure.why})",
                ) from failure
            diagnostic = f"{failure.outcome.name}: {failure.why}"
            narrate.headed(
                f"🔁 #{piece.number} ({piece.layer}) test repair retrying — ", diagnostic
            )
    raise AssertionError("unreachable: the loop always returns or raises")


def _repair_turn(
    record: RunRecord, piece: SliceRecord, slug: str, path: Path, turn: int, diagnostic: str
) -> tuple[list[str], str, dict[str, int]]:
    entry = _begin_repair_turn(record, piece, slug, turn)
    try:
        reply, session = _talk(piece, slug, diagnostic)
    except FlowFailure as failure:
        _end_repair_turn(record, piece, entry, "failed", failure.why)
        raise
    _end_repair_turn(record, piece, entry, "ok", reply["why_they_fail"], session)
    test_files = list(reply["test_files"])
    with narrate.grouped():
        narrate.line(f"📦 Test repair result #{piece.number} ({piece.layer})")
        narrate.fields(
            [
                ("Test files", ", ".join(test_files) or "(none)"),
                ("Why they fail", reply["why_they_fail"]),
            ]
        )
    debt = failing_tests.validate_repaired_tests(
        slug,
        path,
        piece.failing_sha,
        piece.layer,
        test_files,
        piece.test_kind,
        record.story_number,
    )
    return test_files, reply["why_they_fail"], debt


def _talk(piece: SliceRecord, slug: str, diagnostic: str) -> tuple[dict, str]:
    return agents.talk(
        slug,
        "mechanic",
        "correct_failing_tests",
        "failing_tests",
        attribute_failures_to=piece.number,
        slice_number=piece.number,
        slice_title=piece.title,
        branch=slug,
        test_kind=piece.test_kind,
        brief=piece.brief,
        acceptance="\n".join(f"- {item}" for item in piece.acceptance),
        attempt=str(piece.attempts),
        diagnostic=diagnostic,
        objection=_objection_section(piece),
        push_line=(
            f"commit the corrected tests on `{slug}` and do not push: this is the "
            "driver's own repair branch, and the driver merges your commit into the "
            "slice's branch itself"
        ),
    )


def _objection_section(piece: SliceRecord) -> str:
    entry = piece.objections[-1]
    return (
        f"\nThe {entry['role']} implementing this slice rejected these acceptance tests, and "
        f"the driver verified the objection: the tests still fail on its working tree, and "
        f"nothing outside the slice was left there. Repair the tests so an honest "
        f"implementation inside this slice's own layer can make them pass together. You may "
        f"drop or restate a test whose behavior belongs to another layer, and you may change "
        f"how a test selects what it asserts on; you may not weaken them into tests that "
        f"pass with no implementation at all.\n\n{_rendered(entry)}\n"
    )


def _begin_repair_turn(record: RunRecord, piece: SliceRecord, slug: str, turn: int) -> dict:
    """Repair turns keep their own ledger: `turns` is the implementation
    ledger the session, attempt and resume checks read, and a block 1 turn
    on another team and another session has no business in it."""
    entry = {
        "kind": "test_repair",
        "repair": piece.test_repairs + 1,
        "turn": turn,
        "team": slug,
        "status": "running",
        "result": "",
        "why": "",
        "session": "",
    }
    with record.transition():
        piece.test_repair_turns.append(entry)
        record.save()
    return entry


def _end_repair_turn(
    record: RunRecord, piece: SliceRecord, entry: dict, result: str, why: str, session: str = ""
) -> None:
    with record.transition():
        entry.update(status="completed", result=result, why=why, session=session)
        record.save()


def _repair_stopped(
    record: RunRecord, piece: SliceRecord, outcome: Outcome, why: str
) -> FlowFailure:
    return FlowFailure(
        outcome,
        f"{piece.slug}: {why}\n\n{_rendered(piece.objections[-1])}",
        record.story_number,
        add_blocked=True,
    )


def _refreeze(
    record: RunRecord,
    piece: SliceRecord,
    path: Path,
    test_files: list[str],
    why: str,
    debt: dict[str, int],
) -> None:
    """The repaired tests become this slice's inputs: merged into the slice
    branch beside the implementer's uncommitted work, pushed, and recorded.
    `tests_sha` - and with it `acceptance_sha`, the bytes an implementation
    turn may not change - becomes the repair commit; `failing_sha`, the base
    every later check compares HEAD, origin and the diff against, becomes the
    merge; and `tests_type_debt` becomes the debt block 1 accepted on the
    repaired tests, because the rejected set's debt was recorded about files
    that no longer judge this slice."""
    repair_sha = worktrees.local_head(path)
    slice_path = worktrees.slice_worktree_path(piece.slug)
    _merge_repair(record, piece, slice_path, repair_sha)
    merged = worktrees.local_head(slice_path)
    worktrees.push_branch(slice_path, piece.branch)
    note = (
        f"The acceptance tests you rejected were repaired in block 1 and re-frozen at "
        f"{repair_sha[:12]}. They are now {', '.join(test_files)}, and they fail because: "
        f"{why} Read them again before you change anything: your attempts start over "
        f"against these tests, and your accumulated work is still in the worktree."
    )
    with record.transition():
        piece.tests_sha = repair_sha
        piece.failing_sha = merged
        piece.test_files = list(test_files)
        piece.tests_type_debt = dict(debt)
        piece.test_repairs += 1
        piece.attempts = 0
        piece.test_repair_note = note
        piece.diagnostics.append(note)
        piece.move("assigned")
        record.save()
    narrate.line(f"🔒 #{piece.number} ({piece.layer}) tests re-frozen at {repair_sha[:12]}")
    narrate.line(f"⇪ Pushed {piece.branch} at {merged[:12]}")
    _comment(record, piece, repair_sha, test_files, why)


def _merge_repair(record: RunRecord, piece: SliceRecord, slice_path: Path, sha: str) -> None:
    try:
        worktrees.merge_into_slice(
            slice_path,
            sha,
            f"test: repair the acceptance tests for #{piece.number}",
        )
    except Exception as error:
        worktrees.abort_merge(slice_path)
        with record.transition():
            piece.move("failed")
            record.save()
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"{piece.slug}: the repaired acceptance tests {sha[:12]} do not merge into the "
            f"slice's own branch, so the working tree holds changes to files only block 1 "
            f"may write ({error})",
            record.story_number,
            add_blocked=True,
        ) from error


def _comment(
    record: RunRecord, piece: SliceRecord, repair_sha: str, test_files: list[str], why: str
) -> None:
    entry = piece.objections[-1]
    body = (
        f"Acceptance tests repaired for #{piece.number} ({piece.layer}) after the "
        f"{entry['role']}'s objection ({entry['kind']}), repair {piece.test_repairs}"
        f"/{MAX_REPAIRS}.\nCommit: {repair_sha}\nTest files: {', '.join(test_files)}\n\n"
        f"Why they fail: {why}\n\n{_rendered(entry)}"
    )
    narrate.comment_posted(record.story_number, body)
    github.comment(record.story_number, body)


# --- resume --------------------------------------------------------------------


def void_unfinished_repair(record: RunRecord, piece: SliceRecord) -> str | None:
    """A repair turn the driver never saw end is voided like any other turn:
    the ledger keeps the entry, and `repair()` starts the repair again from a
    fresh worktree. Returns what was voided, or None when there was
    nothing."""
    running = [entry for entry in piece.test_repair_turns if entry["status"] == "running"]
    if not running:
        return None
    with record.transition():
        for entry in running:
            entry["status"] = "completed"
            entry["result"] = "void"
            entry["why"] = "voided on resume: the driver stopped while the repair turn ran"
        record.save()
    last = running[-1]
    return f"test repair {last['repair']} turn {last['turn']}"


def repair_team(piece: SliceRecord) -> str:
    """The team a repair of this slice runs on - what a resume has to prove
    is not still working before it relaunches one."""
    return f"{piece.slug}-tests-{piece.test_repairs + 1}"
