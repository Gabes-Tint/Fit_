"""Box: the implementer rejects the acceptance tests, and block 1 repairs
them - the one edge back into block 1, open to block 3's implementation
turns and to block 4's fix turns alike.

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
names - a whole file, or one test as `<file>::<test title>` - why no honest
change in this slice's layer can make them pass together, and the repair it
proposes. The driver never takes that on trust. It checks that the named
files really are this slice's retained acceptance tests, that the acceptance
run on the turn's own working tree still fails on every named test (a whole
file needs one failing test in it), that the tree carries no commit and
nothing outside this slice's reach, and that the objection says something. A
malformed or unverifiable objection is an ordinary failed attempt and costs
the turn's place in the budget; a verified one costs only the turn.

An objection may stand beside finished work, and #421 is why: the builder
objected three times, was right three times, and had the one-line
implementation in its tree the whole way - six of the seven tests would have
passed with it, and the driver had no shape for "these two are wrong, the
rest are done". When the tree carries work, the objection must name a strict
subset of the slice's tests and every test it does not name must already
pass there; the work then stays exactly where it is while the tests it named
are repaired around it, and the next turn is told so.

A verified objection parks the slice in `tests_rejected` and sends the tests
back to block 1 as a correction turn, in a repair worktree of the driver's
own based on the slice's failing-test base, under block 1's usual
validation: test files only, the right kind, the repository's gates, and a
failure on an expectation rather than a throw. The first repair is the
mechanic that wrote the tests; a second goes to the role that objected,
because a mechanic repairing exactly what it was told, and no more, is what
did not end the loop on #421. The repaired commit is merged into the slice
branch - which still holds the implementer's uncommitted work - pushed, and
re-frozen: `tests_sha` becomes the repair commit and `failing_sha` the
merge. The slice then returns to `assigned` with the same role, revision,
assignment, session and worktree and a fresh attempt counter, because the
tests it is judged by are new inputs.

The channel stays open once the slice has succeeded (#463). A block 4 fix
turn may object too, on the same terms and through the same `consider`: the
tree it is judged on sits at the freeze commit the fix request started from,
not the failing-test base, so that is the HEAD it must still be at and the
commit its left-behind work is read against. A refused objection is the fix
turn's ordinary diagnostic and costs that fix attempt; a verified one costs
only the turn. The repair is the same repair against the same budget, but the
slice comes out of it still `fixing`, on the same fix attempt, with the
merged repair as both its failing-test base and its frozen commit: the fix
request carries on against the repaired tests, the freeze that ends it
carries the repair onto the integration branch, and the review takes another
round.

At most two repairs per slice. A third verified objection stops the run as
TESTS_INVALID with every objection in the message, because at that point the
acceptance tests, not the implementer, are what this run cannot get past.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from fitflow import acceptance, agents, audit, github, narrate, siblings, worktrees
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


@dataclass(frozen=True)
class _Checked:
    """What the verification found: the first condition that failed, or -
    when the objection stands - how each named test failed and the work the
    implementer left in the tree beside it. Both are recorded on the
    objection: the failures brief the repairer, and the work is what the
    implementer is told was kept."""

    refusal: str | None = None
    failures: tuple[str, ...] = ()
    work: tuple[str, ...] = field(default=())


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
            "Name a whole acceptance test file, or one test inside it as "
            "`<file>::<test title>`. Name only the tests that cannot pass: an objection "
            "is not about the file it sits in.",
            "",
            "You may object beside finished work. When your worktree carries an "
            "implementation, the objection must name a strict subset of this slice's "
            "tests, every test you do not name must already pass on your tree, and your "
            "work stays exactly where it is while block 1 repairs the tests you named. "
            "That is how six of seven tests get delivered instead of none.",
            "",
            "It is never a way to skip work, and the driver checks it: the tests you "
            "name must be this slice's own acceptance tests, each one must still fail on "
            "your working tree (a whole file must have at least one failing test), and "
            "that tree must carry no commit and nothing outside this slice. An objection "
            "that fails any of those is an ordinary rejected attempt and costs you one of "
            "your three.",
            "",
            "A verified objection sends the tests back to block 1, with your reason and "
            "your proposed fix, and you get a fresh set of attempts against the repaired "
            "tests. Say what is wrong precisely enough for someone else to repair it, and "
            "gaming the tests is never the answer: when your objection stands, say so and "
            "object.",
        ]
    )


# --- verifying one objection ---------------------------------------------------


def consider(
    record: RunRecord,
    piece: SliceRecord,
    reply: dict,
    scope_breach: ScopeBreach,
    fix_turn: bool = False,
) -> str | None:
    """The single call block 3's `_settle` and block 4's `_settle_fix` make
    before they judge a turn the ordinary way. None when the reply carries
    no objection; the diagnostic to correct from when it carries one the
    driver refuses; and `Objected`
    - not a return - when the objection verifies.

    `"objection": null` is how a reply says it has none: the schema lists
    every property in `required` because aarmy's strict subset demands it
    (agents-army-2 orchestrator/schema.py), so the key is always there and
    null carries the meaning a missing key used to. A key that is absent
    anyway means the same thing."""
    raw = reply.get("objection")
    if raw is None:
        return None
    with record.transition():
        piece.move("validating")
        record.save()
    narrate.line(f"📦 Validating #{piece.number} ({piece.layer}) objection to the tests")
    checked = _verify(record, piece, raw, scope_breach, _base(piece, fix_turn))
    if checked.refusal is not None:
        return (
            f"your objection to the acceptance tests was refused: {checked.refusal}. "
            "Object only when the driver can verify it; otherwise implement the slice."
        )
    _accept(record, piece, raw, checked)
    raise Objected


def _base(piece: SliceRecord, fix_turn: bool) -> str:
    """The commit the objecting turn started on. A block 3 turn starts on the
    failing-test base; a block 4 fix turn on the freeze commit its fix
    request started from, which already carries the slice's frozen work."""
    return piece.frozen_commit if fix_turn else piece.failing_sha


def _verify(
    record: RunRecord, piece: SliceRecord, raw: object, scope_breach: ScopeBreach, base: str
) -> _Checked:
    """The first verification condition that fails, or what the accepted
    objection carries. Ordered cheapest first: the reply's own shape, then
    what it names, then the worktree, and only then the test run."""
    path = worktrees.slice_worktree_path(piece.slug)
    shape = _malformed(raw) or _not_this_slice(piece, raw)
    if shape is not None:
        return _Checked(shape)
    head = _moved_head(path, base)
    if head is not None:
        return _Checked(head)
    work = worktrees.changed_since(path, base)
    breach = _out_of_scope(piece, work, scope_breach)
    if breach is not None:
        return _Checked(breach)
    return _verify_on_the_tree(record, piece, path, raw, work)


def _malformed(raw: object) -> str | None:
    """`raw` is never None here - `consider` reads that as "no objection" -
    so anything that is not a well-formed object is a refusal. `proposed_fix`
    may be absent, null or empty: all three mean no fix was proposed."""
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


def _file_of(named: str) -> str:
    """The acceptance test file one named item is about: the whole path, or
    the left half of a `file::test title`."""
    return named.split("::", 1)[0]


def _not_this_slice(piece: SliceRecord, raw: dict) -> str | None:
    """Only this slice's own retained acceptance tests can be sent back to
    block 1: anything else is a file the objection has no standing over. A
    named test is judged by the file it names."""
    stranger = sorted({_file_of(item) for item in raw["tests"]} - set(piece.test_files))
    if not stranger:
        return None
    return (
        f"{', '.join(stranger)} is not a retained acceptance test of this slice; "
        f"this slice's acceptance tests are {', '.join(piece.test_files)}"
    )


def _moved_head(path: Path, base: str) -> str | None:
    """An objection is judged on the turn's own working tree, so that tree
    must still carry no commit of the agent's own."""
    head = worktrees.local_head(path)
    if head == base:
        return None
    return (
        f"local HEAD moved to {head[:7]} — an objection is judged on the turn's own "
        "working tree, and implementation agents never commit"
    )


def _out_of_scope(piece: SliceRecord, work: list[str], scope_breach: ScopeBreach) -> str | None:
    """Work left in the tree beside an objection is allowed - that is how a
    partial objection delivers - but only inside this slice's own reach."""
    breach = scope_breach(piece, work)
    if breach is None:
        return None
    return (
        f"{breach} — put those paths back before objecting: an objection is about the "
        "tests, not a place to leave work outside this slice"
    )


def _verify_on_the_tree(
    record: RunRecord, piece: SliceRecord, path: Path, raw: dict, work: list[str]
) -> _Checked:
    """The objection's own premise, re-taken by the driver test by test: the
    tests it names must still fail here, and - when the implementer left work
    in the tree - every test it does not name must already pass, so the
    repair can happen beside an implementation rather than instead of one.

    One acceptance run over the whole slice's test files answers both. A
    runner that could not report at all is a tooling failure, never a
    verdict on the objection."""
    report = acceptance.run_and_report(path, piece.test_files)
    if not report.ok:
        raise FlowFailure(Outcome.TOOL_FAILED, report.why, record.story_number, add_blocked=True)
    named = list(raw["tests"])
    refusal = _unknown_tests(named, report) or _not_failing(named, report)
    if refusal is None and work:
        refusal = _not_partial(named, report, work)
    if refusal is not None:
        return _Checked(refusal)
    _narrate_verified(piece, named, report, work)
    return _Checked(None, tuple(_failures_of(named, report)), tuple(work))


def _unknown_tests(named: list[str], report: acceptance.Report) -> str | None:
    unknown = [item for item in named if not report.named(item)]
    if not unknown:
        return None
    return (
        f"{', '.join(unknown)} names no test the acceptance run reported; it reported:\n"
        + "\n".join(report.described())
    )


def _not_failing(named: list[str], report: acceptance.Report) -> str | None:
    """Every named test must fail; a whole file must have at least one
    failing test in it. The refusal names which one did not, with the status
    the runner gave it, because "the objection is wrong" is not a
    diagnostic anyone can act on."""
    for item in named:
        statuses = report.named(item)
        passing = [status for status in statuses if not status.failed]
        if "::" in item and passing:
            return (
                f"{item} already passes on this working tree, so there is nothing for "
                f"block 1 to repair there: {passing[0].described()}"
            )
        if "::" not in item and len(passing) == len(statuses):
            listed = "\n".join(status.described() for status in statuses)
            return (
                f"{item} already pass on this working tree, so there is nothing for "
                f"block 1 to repair:\n{listed}"
            )
    return None


def _not_partial(named: list[str], report: acceptance.Report, work: list[str]) -> str | None:
    """An objection beside work in the tree is a claim about part of the
    slice: these tests cannot pass, the rest already do. Both halves are
    checked here - a strict subset, and the rest green - because the
    implementer's work is about to be kept and judged by the tests nobody
    repaired."""
    rest = _rest(named, report)
    if not rest:
        return (
            f"this objection names every acceptance test of the slice, and your tree "
            f"carries work ({', '.join(work)}): name the tests that cannot pass, as "
            "`<file>::<test title>`, or put your work back and object to the whole set"
        )
    failing = [status for status in rest if not status.passed]
    if failing:
        listed = "\n".join(status.described() for status in failing)
        return (
            f"{failing[0].name} does not pass on your working tree, and an objection "
            "beside work is only accepted when every test you did not name already "
            f"passes:\n{listed}"
        )
    return None


def _rest(named: list[str], report: acceptance.Report) -> list[acceptance.TestStatus]:
    """Every test of the slice the objection does not name."""
    objected = {status.name for item in named for status in report.named(item)}
    return [status for status in report.statuses if status.name not in objected]


def _narrate_verified(
    piece: SliceRecord, named: list[str], report: acceptance.Report, work: list[str]
) -> None:
    with narrate.grouped():
        narrate.line(f"🧪 {', '.join(named)} → still failing here, as the objection says ✔")
        narrate.block([status.described() for item in named for status in report.named(item)])
    rest = _rest(named, report)
    if work and rest:
        narrate.line(
            f"🧩 #{piece.number} ({piece.layer}) partial objection: the other "
            f"{len(rest)} acceptance test(s) pass beside it, and the {piece.role}'s work "
            f"stays in the worktree ({', '.join(work)})"
        )


def _failures_of(named: list[str], report: acceptance.Report) -> list[str]:
    """How each named test failed, for the agent that has to repair it."""
    return [
        f"{status.file} {status.described()}"
        for item in named
        for status in report.named(item)
        if status.failed
    ]


def _accept(record: RunRecord, piece: SliceRecord, raw: dict, checked: _Checked) -> None:
    entry = {
        "kind": raw["kind"],
        "tests": list(raw["tests"]),
        "why": raw["why"],
        # null and "" are both "no proposed fix"; the ledger keeps one shape.
        "proposed_fix": raw.get("proposed_fix") or "",
        "role": piece.role,
        "attempt": piece.attempts,
        # how each named test failed, and the work kept beside the objection
        "failures": list(checked.failures),
        "work": list(checked.work),
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
    failures = entry.get("failures") or []
    how = "\nHow each of them failed on the implementer's tree:\n" + "\n".join(failures)
    return (
        f"Objection ({entry['kind']}) from the {entry['role']} at attempt {entry['attempt']} "
        f"about {', '.join(entry['tests'])}:\n{entry['why']}\nProposed fix: {fix}"
        f"{how if failures else ''}"
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
    role = repair_role(piece)
    narrate.line(_repair_headline(piece, number, role))
    slug = f"{piece.slug}-tests-{number}"
    path = worktrees.create_repair_worktree(slug, piece.failing_sha)
    audit.worktree_created(slug)
    narrate.line(f"🌿 Worktree {slug} · branch {slug} at {piece.failing_sha[:12]}")
    agents.ensure_fresh_team(slug, path, piece.number)
    test_files, why, debt, passing_note = _repair_loop(record, piece, slug, path, role)
    _refreeze(record, piece, path, test_files, why, debt, passing_note)
    worktrees.remove_slice_worktree(path)
    worktrees.delete_local_branch(slug)
    agents.delete_team(slug)


def repair_role(piece: SliceRecord) -> str:
    """Who repairs the tests. The first repair goes back to the role that
    wrote them - the mechanic, unless block 1's own ladder escalated and
    the builder or solver finished them: it knows what it meant, and most
    objections are a detail it can put right. The second goes to the role
    that objected -
    the builder or solver whose own tree already holds the implementation
    those tests are wrong about - because the first repair answered the
    objection it was given and was objected to again, and a mechanic that
    fixes exactly what it is told, and no more, is precisely what did not
    work (#421). Nothing else changes: the same repair worktree, the same
    brief, the same two turns, the same validation."""
    if piece.test_repairs == 0 or not piece.objections:
        return piece.tests_role or "mechanic"
    return piece.objections[-1]["role"]


def _repair_headline(piece: SliceRecord, number: int, role: str) -> str:
    head = (
        f"🩹 Repairing #{piece.number} ({piece.layer}) tests in block 1 "
        f"(repair {number}/{MAX_REPAIRS}"
    )
    if number == 1:
        return f"{head})"
    return f"{head}, {role} — the mechanic's repair was objected to again)"


def _repair_loop(
    record: RunRecord, piece: SliceRecord, slug: str, path: Path, role: str
) -> tuple[list[str], str, dict[str, int], str]:
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
            f"🔧 {role.capitalize()} #{piece.number} ({piece.layer}) test repair turn "
            f"{turn}/{REPAIR_TURNS}"
        )
        try:
            return _repair_turn(record, piece, slug, path, turn, diagnostic, role)
        except FlowFailure as failure:
            if failure.outcome not in failing_tests.REPAIRABLE_OUTCOMES:
                raise _repair_stopped(record, piece, failure.outcome, failure.why) from failure
            if turn == REPAIR_TURNS:
                _mark_repair_spent(record, piece)
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


def _mark_repair_spent(record: RunRecord, piece: SliceRecord) -> None:
    """Block 1 spent both turns of this repair and the tests came out of it
    still rejected. `test_repairs` never moves for such a repair - only a
    re-freeze bumps it - so nothing else on the record says the budget went:
    a `--resume` read the counter, named the branch `<slug>-tests-<n>` again
    and relaunched the very repair that had just been refused twice. The
    number is kept instead, and the resume stops on it (#337 run 6)."""
    with record.transition():
        piece.test_repair_spent = piece.test_repairs + 1
        record.save()


def _repair_turn(
    record: RunRecord,
    piece: SliceRecord,
    slug: str,
    path: Path,
    turn: int,
    diagnostic: str,
    role: str,
) -> tuple[list[str], str, dict[str, int], str]:
    entry = _begin_repair_turn(record, piece, slug, turn, role)
    try:
        reply, session = _talk(piece, slug, path, diagnostic, role)
    except FlowFailure as failure:
        _end_repair_turn(record, piece, entry, "failed", failure.why)
        raise
    _end_repair_turn(record, piece, entry, "ok", reply["why_they_fail"], session)
    named = list(reply["test_files"])
    test_files = _judged_set(piece, named)
    with narrate.grouped():
        narrate.line(f"📦 Test repair result #{piece.number} ({piece.layer})")
        narrate.fields(
            [
                ("Repaired", ", ".join(named) or "(none)"),
                ("Judged", ", ".join(test_files) or "(none)"),
                ("Why they fail", reply["why_they_fail"]),
            ]
        )
    kept, debt, passing_note = failing_tests.validate_repaired_tests(
        slug,
        path,
        piece.failing_sha,
        piece.layer,
        test_files,
        piece.test_kind,
        record.story_number,
        named,
        list(piece.objections[-1]["tests"]),
    )
    return kept, reply["why_they_fail"], debt, passing_note


def _judged_set(piece: SliceRecord, named: list[str]) -> list[str]:
    """What the repair is judged on: this slice's whole acceptance set, in
    the order it was frozen in, with anything the reply names appended.

    The reply's own list used to replace it, and #422 run 4 is what that
    cost. Slice #452 froze two acceptance files, one of them carrying the
    type errors block 1 had accepted as the missing API showing through
    (`tests_type_debt`); the repair changed one line in the other and named
    only that file, so the second file stopped being an acceptance file
    mid-repair, its accepted debt was re-read as "type errors outside the
    acceptance tests", and the turn was rejected for the one thing nobody
    had done. The tolerance has to keep covering every acceptance file the
    repair did not touch, because every one of them still judges the
    slice."""
    return list(dict.fromkeys(piece.test_files + named))


#: What the prompt's diagnostic slot says when the objection is the whole
#: diagnostic. The template asks "the driver rejected the tests with this
#: concrete diagnostic", and on a repair's first turn that diagnostic is the
#: objection `_objection_section` has already quoted in full - so #337 run 6
#: sent the solver the same wall of text twice. It is quoted once now, and
#: the slot says where it is.
_THE_OBJECTION_ITSELF = (
    "The objection quoted above is the whole of it: the driver verified that objection "
    "and rejected nothing else about these tests. Do not wait for another diagnostic - "
    "repair what the objection is about."
)


def _talk(
    piece: SliceRecord, slug: str, path: Path, diagnostic: str, role: str
) -> tuple[dict, str]:
    return agents.talk(
        slug,
        role,
        "correct_failing_tests",
        "failing_tests",
        attribute_failures_to=piece.number,
        role_name=role,
        role_capitalized=role.capitalize(),
        siblings=siblings.section(path, piece.test_kind, piece.test_files),
        slice_number=piece.number,
        slice_title=piece.title,
        branch=slug,
        test_kind=piece.test_kind,
        brief=piece.brief,
        acceptance="\n".join(f"- {item}" for item in piece.acceptance),
        attempt=str(piece.attempts),
        diagnostic=_diagnostic_slot(piece, diagnostic),
        objection=_objection_section(piece, role),
        push_line=(
            f"commit the corrected tests on `{slug}` and do not push: this is the "
            "driver's own repair branch, and the driver merges your commit into the "
            "slice's branch itself"
        ),
    )


def _diagnostic_slot(piece: SliceRecord, diagnostic: str) -> str:
    """The prompt's diagnostic, said once. A repair's first turn is given
    the objection itself as its diagnostic, and the objection section above
    it in the same prompt renders exactly those bytes; every later turn is
    given block 1's own verdict on the last repair, which is nowhere else
    in the prompt."""
    if diagnostic.strip() == _rendered(piece.objections[-1]).strip():
        return _THE_OBJECTION_ITSELF
    return diagnostic


def _objection_section(piece: SliceRecord, role: str) -> str:
    entry = piece.objections[-1]
    return (
        f"\nThe {entry['role']} implementing this slice rejected these acceptance tests, and "
        f"the driver verified the objection: the tests still fail on its working tree, and "
        f"nothing outside the slice was left there. Repair the tests so an honest "
        f"implementation inside this slice's own layer can make them pass together. You may "
        f"drop or restate a test whose behavior belongs to another layer, and you may change "
        f"how a test selects what it asserts on; you may not weaken them into tests that "
        f"pass with no implementation at all."
        f"{_kept_work(entry)}{_history(piece, role)}\n\n{_rendered(entry)}\n"
    )


def _kept_work(entry: dict) -> str:
    """A partial objection is repaired beside an implementation that is
    already in the slice's worktree, and the repair must not be written as
    though nothing had been built."""
    work = entry.get("work") or []
    if not work:
        return ""
    return (
        f" The implementer left its work in the slice's worktree ({', '.join(work)}) and it "
        f"is kept: every acceptance test it did not name passes on that tree, so repair only "
        f"the tests named below and leave the others as they are."
    )


def _history(piece: SliceRecord, role: str) -> str:
    """What the second repair is told that the first was not: every
    objection so far, what each repair replied, and that this one is being
    made by the role that objected rather than by the mechanic."""
    if piece.test_repairs == 0:
        return ""
    earlier = "\n\n".join(_rendered(item) for item in piece.objections[:-1])
    return (
        f"\n\nThis is repair {piece.test_repairs + 1} of {MAX_REPAIRS}. Block 1 already "
        f"repaired these tests {piece.test_repairs} time(s) and the objection came back, so "
        f"this repair is yours: you are the {role} that implements this slice, and you have "
        f"seen what the tests ask for. Do not repeat the last repair's answer - read the "
        f"whole history below and repair what the objections are actually about.\n\n"
        f"Earlier objections:\n\n{earlier}\n\nWhat the repairs replied:\n{_replies(piece)}"
    )


def _replies(piece: SliceRecord) -> str:
    """What each repair turn answered - once per turn, and nothing for the
    turn that has not happened yet.

    The ledger holds more than one entry per turn on purpose: a relaunched
    repair appends its own beside the dead one's, and `_begin_repair_turn`
    puts the turn being launched on it before the agent is asked anything.
    #337 run 6 read all of them into the prompt, so the solver was handed
    the same two repairs twice in two different wordings and an empty line
    for the turn it was about to take. The last entry for a turn is the one
    that says what that turn did."""
    latest: dict[tuple[int, int], dict] = {}
    for item in piece.test_repair_turns:
        if item["status"] == "running" or not (item["why"] or item["result"]):
            continue
        latest[(item["repair"], item["turn"])] = item
    return "\n".join(
        f"- repair {item['repair']} turn {item['turn']} ({item.get('role', 'mechanic')}): "
        f"{item['why'] or item['result']}"
        for item in latest.values()
    )


def _begin_repair_turn(
    record: RunRecord, piece: SliceRecord, slug: str, turn: int, role: str
) -> dict:
    """Repair turns keep their own ledger: `turns` is the implementation
    ledger the session, attempt and resume checks read, and a block 1 turn
    on another team and another session has no business in it."""
    entry = {
        "kind": "test_repair",
        "repair": piece.test_repairs + 1,
        "turn": turn,
        "team": slug,
        "role": role,
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
    passing_note: str = "",
) -> None:
    """The repaired tests become this slice's inputs: merged into the slice
    branch beside the implementer's uncommitted work, pushed, and recorded.
    `tests_sha` - and with it `acceptance_sha`, the bytes an implementation
    turn may not change - becomes the repair commit; `failing_sha`, the base
    every later check compares HEAD, origin and the diff against, becomes the
    merge; and `tests_type_debt` becomes the debt block 1 accepted on the
    repaired tests, because the rejected set's debt was recorded about files
    that no longer judge this slice.

    `test_files` is the judged union `_judged_set` built, less whatever the
    objection named and the repair deleted, so a slice comes out of a repair
    with the acceptance set it went in with plus the repair's own files.

    An objection from a block 4 fix turn comes out differently: the slice
    stays `fixing` and keeps its attempt counter, because the fix request
    goes on against the repaired tests rather than starting over, and the
    merge becomes its frozen commit as well - the commit its next fix turn
    starts on, is judged against, and must change something beyond."""
    repair_sha = worktrees.local_head(path)
    slice_path = worktrees.slice_worktree_path(piece.slug)
    fix_turn = in_fix_request(piece)
    kept = _kept_note(piece, slice_path, test_files)
    _merge_repair(record, piece, slice_path, repair_sha)
    merged = worktrees.local_head(slice_path)
    worktrees.push_branch(slice_path, piece.branch)
    goes_on = (
        "your fix request goes on against these tests, on the fix attempt the objection was "
        "made in, and your frozen work is still in the worktree"
        if fix_turn
        else "your attempts start over against these tests, and your accumulated work is still "
        "in the worktree"
    )
    note = (
        f"The acceptance tests you rejected were repaired in block 1 and re-frozen at "
        f"{repair_sha[:12]}. They are now {', '.join(test_files)}, and they fail because: "
        f"{why}{kept} Read them again before you change anything: {goes_on}."
    )
    with record.transition():
        piece.tests_sha = repair_sha
        piece.failing_sha = merged
        piece.test_files = list(test_files)
        piece.tests_type_debt = dict(debt)
        piece.test_repairs += 1
        piece.test_repair_note = note
        piece.diagnostics.append(note)
        if fix_turn:
            piece.frozen_commit = merged
            piece.move("fixing")
        else:
            piece.attempts = 0
            piece.move("assigned")
        record.save()
    narrate.line(f"🔒 #{piece.number} ({piece.layer}) tests re-frozen at {repair_sha[:12]}")
    narrate.line(f"⇪ Pushed {piece.branch} at {merged[:12]}")
    _comment(record, piece, repair_sha, test_files, why, passing_note)


def in_fix_request(piece: SliceRecord) -> bool:
    """Whether the objection being repaired was made by a block 4 fix turn:
    repair turns keep their own ledger, so the implementation ledger's last
    turn is still the one that objected."""
    return bool(piece.turns) and piece.turns[-1]["kind"] == "review_fix"


def _kept_note(piece: SliceRecord, slice_path: Path, test_files: list[str]) -> str:
    """What the implementer is told about its own work. A partial objection
    was accepted precisely because the rest of the slice already passed, so
    the next turn must know that what it built is still there and what was
    repaired around it - otherwise the obvious reading of "the tests were
    repaired" is "start again"."""
    work = worktrees.changed_since(slice_path, piece.failing_sha)
    if not work:
        return ""
    repaired = _repaired_names(piece.objections[-1], test_files)
    return (
        f" Your own work was kept exactly as you left it ({', '.join(work)}); the repair "
        f"changed only {repaired}, and every other acceptance test of this slice passed on "
        f"your tree when you objected."
    )


def _repaired_names(entry: dict, test_files: list[str]) -> str:
    """Which tests the repair was about, named the way the implementer named
    them - but only while the file it named still judges this slice: a file
    the repair replaced outright is gone, and naming it would send the next
    turn looking for it."""
    named = [item for item in entry["tests"] if _file_of(item) in test_files]
    return ", ".join(named) if named else "the tests you rejected"


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
    record: RunRecord,
    piece: SliceRecord,
    repair_sha: str,
    test_files: list[str],
    why: str,
    passing_note: str = "",
) -> None:
    entry = piece.objections[-1]
    already = f"\n\n{passing_note}" if passing_note else ""
    body = (
        f"Acceptance tests repaired for #{piece.number} ({piece.layer}) after the "
        f"{entry['role']}'s objection ({entry['kind']}), repair {piece.test_repairs}"
        f"/{MAX_REPAIRS}.\nCommit: {repair_sha}\nTest files: {', '.join(test_files)}\n\n"
        f"Why they fail: {why}{already}\n\n{_rendered(entry)}"
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
