"""Box: block 1 writes failing acceptance tests.

The driver prepares slice worktrees and teams sequentially. Once all are
ready, it runs one writer per slice concurrently and waits for every result.
Each role gets one initial turn and at most two repair turns in the same
session/worktree; when a role's budget ends with the tests still rejected,
block 1 escalates a rung - mechanic, builder, solver - on the same branch
and worktree, with every diagnostic so far in the successor's brief. The
full independent validation runs after every turn.

That validation runs *all* of its checks and reports their union. Block 1
used to stop at the first one that failed, so run 5 of #397 spent the
mechanic's three attempts on three different gates surfaced one per attempt
- type errors, then a clone, then a misspelling - and stopped with tests
that were one word away from valid. Every gate now runs to completion and
the mechanic gets one diagnostic naming all of them, because a correction
can answer three failures as easily as one when it is told about three.
Only a rejection that makes the later checks meaningless - a non-test file
on the branch, a test in the wrong folder, reported files that are not in
the diff - still short-circuits.

Block 1's progress lives in the run's retained record, which slicing
created before any writer started: every launch, every rejection, every
escalation and every freeze is saved as it happens (_Ledger). A stopped
run's `--resume` comes back here for the slices whose tests are not frozen,
on the same worktree and team, and relaunches the recorded role at the same
revision with the retained diagnostic and every rejection so far. Frozen
slices are left alone, and no planner turn is asked for again.
"""

import re
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from fitflow import (
    acceptance,
    agents,
    audit,
    failure_reason,
    gates,
    github,
    lanes,
    narrate,
    runstate,
    settings,
    turns,
    worktrees,
)
from fitflow.diagnostics import same_diagnostic
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord, SliceRecord
from fitflow.slice import Slice

_REPAIRABLE_OUTCOMES = {
    Outcome.TESTS_NOT_PUSHED,
    Outcome.TESTS_DO_NOT_FAIL,
    Outcome.TESTS_INVALID,
}
# The same verdicts the block 3 objection loop's own repair budget retries.
REPAIRABLE_OUTCOMES = frozenset(_REPAIRABLE_OUTCOMES)

#: Block 1's capability ladder, the same rungs and the same order block 3
#: escalates through (steps/implement._SUCCESSOR). A role that ends its
#: budget with the tests still rejected hands them to the next one; the
#: solver is the last rung, and its exhaustion is the run's stop.
_SUCCESSOR = {"mechanic": "builder", "builder": "solver"}

#: How the acceptance run is named in the union of block 1's checks.
_ACCEPTANCE = "fails as intended"


class ReasonedRefusal(FlowFailure):
    """The mechanic wrote no acceptance test and said why it could not.

    Every other block 1 rejection describes something on the branch that a
    second turn could change. This one describes the mechanic's reading of
    the brief, and a retry puts the same brief to the same agent in the
    same session: it stops the run at once, carrying the reason to the
    story, instead of spending two more turns reproducing it - which is
    what #423 did, three identical refusals deep."""


@dataclass(frozen=True)
class PreparedSlice:
    piece: Slice
    slug: str
    path: Path
    record: RunRecord


def write_failing_tests(
    slices: list[Slice],
    story_number: int,
    record: RunRecord | None = None,
    resume: bool = False,
) -> list[Slice]:
    """Write every slice's failing acceptance tests whose tests the record
    does not already hold frozen. `record` is the run's retained record,
    loaded when not given; `resume` reuses the worktree and team a stopped
    run left instead of refusing them as stale."""
    record = record or runstate.load_run(story_number)
    pending = [piece for piece in slices if not record.slices[piece.layer].acceptance_sha]
    prepared = [_prepare(piece, record, resume) for piece in pending]
    if not prepared:
        return slices
    if len(prepared) == 1:
        _write_tests(prepared[0])
        return slices

    narrate.line(f"⚡ Starting {len(prepared)} mechanics in parallel")
    failures = _run_parallel(prepared)
    narrate.line(f"⏳ Mechanic barrier: all {len(prepared)} slices settled")
    if failures:
        for item, failure in failures:
            narrate.line(
                f"❌ Mechanic #{item.piece.number} ({item.piece.layer}): {_failure(failure)}"
            )
        first = failures[0][1]
        if isinstance(first, FlowFailure):
            raise FlowFailure(first.outcome, first.why, story_number) from first
        raise first
    return slices


def _prepare(piece: Slice, record: RunRecord, resume: bool) -> PreparedSlice:
    slug = f"story-{piece.number}-{piece.layer}"
    if resume and worktrees.slice_worktree_path(slug).exists():
        return _reuse(piece, record, slug)
    if resume and record.slices[piece.layer].tests_attempts:
        raise FlowFailure(
            Outcome.RUN_STATE_CONFLICT,
            f"{slug}: block 1 launched a writer there but its worktree is missing; audit it, "
            f"then `go.py {record.story_number} --reset`",
            record.story_number,
        )
    if worktrees.slice_worktree_exists(slug):
        raise FlowFailure(
            Outcome.WORKTREE_EXISTS, f"worktree/branch '{slug}' already exists", piece.number
        )
    path = worktrees.create_slice_worktree(slug)
    audit.worktree_created(slug)
    narrate.line(f"🌿 Worktree {slug} · branch {slug}")
    agents.ensure_fresh_team(slug, path, piece.number)
    return PreparedSlice(piece, slug, path, record)


def _reuse(piece: Slice, record: RunRecord, slug: str) -> PreparedSlice:
    """A resumed slice keeps what the stopped run gave it: the worktree with
    whatever the last writer left in it, and the team that still owns that
    worktree. A team with no link left is linked again to the same one."""
    held = record.slices[piece.layer]
    path = worktrees.slice_worktree_path(slug)
    if (settings.TEAMS_DIR / held.team / "worktree").is_symlink():
        runstate.verify_team_ownership(held)
    else:
        agents.ensure_fresh_team(slug, path, piece.number)
    narrate.line(f"♻️  Worktree {slug} · branch {slug} · team {held.team}: reused")
    return PreparedSlice(piece, slug, path, record)


def _run_parallel(prepared: list[PreparedSlice]) -> list[tuple[PreparedSlice, Exception]]:
    with ThreadPoolExecutor(max_workers=len(prepared), thread_name_prefix="fit-mechanic") as pool:
        futures = [(item, pool.submit(_write_tests, item)) for item in prepared]
        return _collect_failures(futures)


def _collect_failures(
    futures: list[tuple[PreparedSlice, Future[None]]],
) -> list[tuple[PreparedSlice, Exception]]:
    failures = []
    for item, future in futures:
        try:
            future.result()
        except Exception as error:  # collected in deterministic slice order after the barrier
            failures.append((item, error))
    return failures


def _failure(error: Exception) -> str:
    if isinstance(error, FlowFailure):
        return f"{error.outcome.name} — {error.why}"
    return f"{type(error).__name__} — {error}"


def _repairable(failure: FlowFailure) -> bool:
    return failure.outcome in _REPAIRABLE_OUTCOMES and not isinstance(failure, ReasonedRefusal)


class _Ledger:
    """One slice's block 1 history: which role is writing, how many rungs
    block 1 has climbed, the attempt it is on and every rejection any of
    them was given. It is what block 3's `piece.assignments` is to an
    implementation slice, and it lives in the run's retained record: each
    launch, verdict, escalation and freeze is saved as it happens, so a
    `--resume` rebuilds the ledger from the record and relaunches the same
    role at the same revision, briefed exactly as the stopped run would have
    briefed it."""

    def __init__(self, record: RunRecord, held: SliceRecord) -> None:
        self.record = record
        self.held = held
        self.role = held.tests_role or "mechanic"
        self.revision = held.tests_revision
        self.attempts = held.tests_attempts
        self.judged = held.tests_judged
        self.spent = held.tests_spent
        self.rejections: list[dict] = [dict(entry) for entry in held.tests_rejections]

    def _save(self) -> None:
        with self.record.transition():
            held = self.held
            held.tests_role, held.tests_revision = self.role, self.revision
            held.tests_attempts, held.tests_judged = self.attempts, self.judged
            held.tests_spent = self.spent
            held.tests_rejections = [dict(entry) for entry in self.rejections]
            self.record.save()

    def launched(self, attempt: int) -> None:
        self.attempts = attempt
        self._save()

    def rejected(self, attempt: int, diagnostic: str) -> None:
        self.rejections.append(
            {
                "role": self.role,
                "revision": self.revision,
                "attempt": attempt,
                "diagnostic": diagnostic,
            }
        )
        self.judged = attempt
        self._save()

    def escalated(self, successor: str) -> None:
        self.spent += self.attempts
        self.role, self.revision = successor, self.revision + 1
        self.attempts, self.judged = 0, 0
        self._save()

    def froze(self, piece: Slice) -> None:
        """The tests are written, validated and pushed: their commit is the
        slice's failing-test commit from here on."""
        with self.record.transition():
            self.held.test_files = list(piece.test_files)
            self.held.tests_type_debt = dict(piece.tests_type_debt)
            self.held.failing_sha = self.held.tests_sha = piece.commit
            self._save()

    def _verdicts(self) -> list[str]:
        """This role's own diagnostics, in attempt order."""
        return [
            entry["diagnostic"] for entry in self.rejections if entry["revision"] == self.revision
        ]

    def ended(self) -> bool:
        """Whether this role's budget already ended in a stopped run: spent
        to the last attempt, or stopped early on a repeated diagnostic. A
        fresh role has judged nothing, so it never has."""
        verdicts = self._verdicts()
        repeated = len(verdicts) >= 2 and same_diagnostic(verdicts[-2], verdicts[-1])
        return self.judged >= turns.BUDGET or repeated

    def window(self) -> tuple[int, int, str]:
        """The attempts this role may still take and the diagnostic the
        first of them is corrected from: the one after the last verdict -
        a launch the driver never judged is relaunched under its own
        number - through the budget, or that single attempt when the budget
        had ended and a resume granted it."""
        verdicts = self._verdicts()
        first = self.judged + 1
        last = first if self.ended() else turns.BUDGET
        return first, last, verdicts[-1] if verdicts else ""

    def grant_grace(self) -> None:
        """A resumed role whose budget had ended gets one more attempt, once:
        the run is being resumed because something changed. A grace attempt
        launched and never judged is relaunched; one that was judged is the
        end, and the call is a human's."""
        if self.held.tests_grace_granted:
            if self.attempts > self.judged:
                return
            raise FlowFailure(
                Outcome.RUN_STATE_CONFLICT,
                f"{self.held.slug}: the {self.role} has spent its block 1 attempts and the one "
                f"grace attempt past them, and the acceptance tests are still rejected; repair "
                f"them by hand, or `go.py {self.record.story_number} --reset`",
                self.record.story_number,
            )
        with self.record.transition():
            self.held.tests_grace_granted = True
            self.record.save()
        narrate.line(
            f"♻️  Block 1 #{self.held.number}: the {self.role}'s budget had ended — "
            "granting one grace attempt on resume"
        )

    def budget_note(self) -> str:
        """How this role's budget ended, for the escalation line: spent to
        the last attempt, or deliberately left unspent on a repeat."""
        if self.attempts >= turns.BUDGET:
            return f"exhausted its {turns.BUDGET} attempts"
        return turns.unspent_attempts(self.attempts)

    def history(self) -> str:
        return "\n".join(
            f"{index}. {entry['role']} attempt {entry['attempt']} — {entry['diagnostic']}"
            for index, entry in enumerate(self.rejections, start=1)
        )

    def briefing(self) -> str:
        """What the successor is told: every rejection this slice's tests
        have collected, oldest first, and what it is being asked to do with
        them."""
        return (
            f"Block 1 escalated these acceptance tests to you: the {self.previous} could not "
            f"get them past the driver's checks and its attempts are spent. The branch and "
            f"worktree are the ones it left. Every rejection so far, oldest first:\n\n"
            f"{self.history()}\n\nRead the tests as they stand on the branch before you change "
            f"anything, then correct them so that all of these are answered at once."
        )

    def resumed_briefing(self, diagnostic: str) -> str:
        """What a resumed turn is corrected from: the retained diagnostic,
        then the whole history it belongs to."""
        return (
            f"{diagnostic}\n\nThis run was stopped and resumed on the same branch and worktree. "
            f"Every rejection these acceptance tests have collected so far, oldest first:\n\n"
            f"{self.history()}"
        )

    @property
    def previous(self) -> str:
        return next(role for role, successor in _SUCCESSOR.items() if successor == self.role)


def _write_tests(prepared: PreparedSlice) -> None:
    """Block 1's role ladder for one slice. Each role gets the whole turn
    budget on the same branch, worktree and team; a role that ends it with
    the tests still rejected hands them to the next rung with every
    diagnostic so far, exactly as block 3 escalates an implementation
    (steps/implement._escalate_or_stop). The solver's exhaustion is the
    stop: before #437 the mechanic's was, and #397 stalled on tests one
    word away from valid.

    A resumed slice's ledger comes from the record. A role whose budget
    had ended there, with a rung left above it, is escalated exactly as the
    stopped run was about to."""
    ledger = _Ledger(prepared.record, prepared.record.slices[prepared.piece.layer])
    if ledger.ended() and ledger.role in _SUCCESSOR:
        _escalate(prepared, ledger)
    while True:
        try:
            _run_role(prepared, ledger)
            return
        except FlowFailure as failure:
            if ledger.role not in _SUCCESSOR or not _repairable(failure):
                raise
            _escalate(prepared, ledger)


def _run_role(prepared: PreparedSlice, ledger: _Ledger) -> None:
    """One role's whole budget, in block 1's own repair loop - or what is
    left of it when a resume continues the role."""
    piece = prepared.piece
    label = f"{ledger.role.capitalize()} #{piece.number}"
    if ledger.ended():
        ledger.grant_grace()
    first, last, retained = ledger.window()

    def attempt_turn(attempt: int, diagnostic: str) -> None:
        ledger.launched(attempt)
        if attempt == first and diagnostic:
            diagnostic = ledger.resumed_briefing(diagnostic)
        with narrate.grouped():
            scale = f"{attempt}/{turns.BUDGET}" if attempt <= turns.BUDGET else f"{attempt} (grace)"
            narrate.line(f"🔧 {label} ({piece.layer}) attempt {scale}")
        try:
            _run_attempt(prepared, ledger, attempt, diagnostic)
        except FlowFailure as failure:
            if _repairable(failure):
                ledger.rejected(attempt, f"{failure.outcome.name}: {failure.why}")
            raise

    turns.repair_loop(label, attempt_turn, _repairable, first, last, retained)


def _escalate(prepared: PreparedSlice, ledger: _Ledger) -> None:
    """Hand the tests to the next rung: one level, the same branch, a fresh
    budget, and the roster's own model and effort for that role."""
    piece = prepared.piece
    successor = _SUCCESSOR[ledger.role]
    note = ledger.budget_note()
    ledger.escalated(successor)
    agent = agents.roster_entry(successor)
    narrate.line(
        f"⬆️  Block 1 #{piece.number}: {ledger.previous} {note} — "
        f"the {successor} takes over the tests"
    )
    narrate.fields([("Backend", agent.backend), ("Model", agent.model), ("Effort", agent.effort)])


def _run_attempt(prepared: PreparedSlice, ledger: _Ledger, attempt: int, diagnostic: str) -> None:
    piece, slug, path = prepared.piece, prepared.slug, prepared.path
    first = attempt == 1 and ledger.revision == 0
    reply, _session = agents.talk(
        slug,
        ledger.role,
        "failing_tests" if first else "correct_failing_tests",
        "failing_tests",
        attribute_failures_to=piece.number,
        slice_number=piece.number,
        slice_title=piece.title,
        branch=slug,
        test_kind=piece.test_kind,
        brief=piece.brief,
        acceptance="\n".join(f"- {item}" for item in piece.acceptance),
        attempt=str(ledger.spent + attempt - 1),
        # an escalated role's first turn inherits the whole history instead
        # of the one diagnostic its predecessor died on
        diagnostic=diagnostic or ("" if first else ledger.briefing()),
        role_name=ledger.role,
        role_capitalized=ledger.role.capitalize(),
        # block 1's own correction turn continues in the session that wrote
        # the tests: it needs no inventory of the neighbors it just read
        siblings="",
        objection="",
        push_line=f"commit and push the corrected tests to `{slug}`",
    )
    test_files = list(reply["test_files"])
    with narrate.grouped():
        narrate.line(f"📦 {ledger.role.capitalize()} result #{piece.number} ({piece.layer})")
        narrate.fields(
            [
                ("Test files", ", ".join(test_files) or "(none)"),
                ("Why they fail", reply["why_they_fail"]),
            ]
        )
    _check_not_a_reasoned_refusal(test_files, reply["why_they_fail"], piece.number)
    debt, passing_note = _verify_pushed(prepared, test_files)
    piece.test_files = list(test_files)
    piece.tests_type_debt = debt
    piece.tests_role = ledger.role
    piece.tests_revision = ledger.revision
    piece.commit = worktrees.local_head(path)
    ledger.froze(piece)
    _comment(piece.number, slug, path, test_files, reply["why_they_fail"], ledger, passing_note)


def _check_not_a_reasoned_refusal(test_files: list[str], why: str, story_number: int) -> None:
    """A reply with no test files and a stated reason is a refusal, not a
    slip: the mechanic is telling the driver that this brief cannot be
    turned into a failing acceptance test. The prompt asks for exactly that
    shape when the mechanic believes it, and the run stops on it with the
    reason. An empty reply with no reason is the ordinary repairable
    "reported no test files"."""
    if test_files or not why.strip():
        return
    raise ReasonedRefusal(
        Outcome.TESTS_NOT_PUSHED,
        "the mechanic wrote no acceptance tests and gave a reason a retry cannot change: "
        + why.strip(),
        story_number,
    )


def _verify_pushed(prepared: PreparedSlice, test_files: list[str]) -> tuple[dict[str, int], str]:
    """Every check the branch must pass before its bytes become immutable.
    Returns the type debt the acceptance tests carry - how many type and
    type-aware lint errors each one has because the API it calls does not
    exist yet, which block 3 reads to tell "the implementation has not
    provided the signature yet" from "block 1 accepted a broken test" - and
    the freeze's note about the tests that already pass on the base."""
    piece, slug, path = prepared.piece, prepared.slug, prepared.path
    story_number = piece.number
    if not worktrees.is_clean(path):
        raise FlowFailure(Outcome.TESTS_NOT_PUSHED, f"tree not clean on {slug}", story_number)
    if worktrees.remote_head(slug) != worktrees.local_head(path):
        raise FlowFailure(
            Outcome.TESTS_NOT_PUSHED, f"local HEAD not pushed on {slug}", story_number
        )
    if not test_files:
        raise FlowFailure(Outcome.TESTS_NOT_PUSHED, "mechanic reported no test files", story_number)
    changed = worktrees.changed_files(path, slug)
    _check_reported_files_are_on_branch(slug, test_files, changed, story_number)
    _check_every_changed_file_is_test_side(slug, piece.layer, changed, story_number)
    _check_files_match_test_kind(
        slug, piece.layer, changed, test_files, piece.test_kind, story_number
    )
    _check_test_files_are_where_they_belong(slug, piece.layer, changed, story_number)
    _check_test_quality(slug, path, test_files, story_number)
    checks = _branch_checks(piece.layer, story_number, path, test_files, changed)
    debt = _judged(checks, story_number)
    narrate.line(
        f"🔍 Verify #{story_number}: tree clean ✔ · pushed ✔ · files on branch ✔ · "
        "only tests ✔ · " + _branch_gate_summary(piece.layer, changed)
    )
    return debt, _passing_note(checks)


def _merged(first: dict[str, int], second: dict[str, int]) -> dict[str, int]:
    return {name: first.get(name, 0) + second.get(name, 0) for name in first | second}


def _branch_gate_summary(layer: str, changed: list[str], placement: bool = True) -> str:
    if layer == "workflow":
        return " · ".join(f"{name} ✔" for name in gates.workflow_gate_names(changed))
    placed = "placed right ✔ · " if placement else ""
    return placed + "lint ✔ · types ✔ · " + ", ".join(gates.FAILING_BRANCH_STEPS) + " ✔"


@dataclass(frozen=True)
class _Verdict:
    """One block 1 check's outcome: what it contributes to the narrated
    union, the rejection it found (None when it passed), and the type debt
    it accepted."""

    label: str
    entries: tuple[str, ...]
    failure: FlowFailure | None = None
    debt: dict[str, int] = field(default_factory=dict)
    # what the acceptance run found already passing, for the freeze to say
    passing_note: str = ""


def _branch_checks(
    layer: str, story_number: int, path, test_files: list[str], changed: list[str]
) -> list[_Verdict]:
    """Every gate the acceptance tests must already pass, plus the
    acceptance run itself - all of them, whatever the earlier ones said.
    A workflow slice changes Python and prose, so the repository's
    TypeScript lanes have nothing to say about it and the driver's own four
    run instead (those stop at their first failing step, in gates.py's own
    loop) - and a Python test names no TypeScript API, so such a slice
    never carries debt.

    A crashed gate still raises where it stands: an external tool failure is
    not a verdict on the tests, so there is nothing to aggregate it with."""
    if layer == "workflow":
        return [
            _workflow_verdict(path, story_number, changed),
            _acceptance_verdict(path, test_files, story_number),
        ]
    return [
        _lint_verdict(path, test_files, story_number),
        _type_verdict(path, test_files, story_number),
        _content_verdict(path, test_files, story_number),
        _acceptance_verdict(path, test_files, story_number),
    ]


def _judged(verdicts: list[_Verdict], story_number: int) -> dict[str, int]:
    """The union of every check: the type debt when they all passed, and
    one diagnostic naming every failure when they did not."""
    failed = [verdict for verdict in verdicts if verdict.failure is not None]
    if not failed:
        debt: dict[str, int] = {}
        for verdict in verdicts:
            debt = _merged(debt, verdict.debt)
        return debt
    narrate.line(
        "🧪 Gates: " + " · ".join(entry for verdict in verdicts for entry in verdict.entries)
    )
    raise _one_diagnostic(failed, story_number)


def _one_diagnostic(failed: list[_Verdict], story_number: int) -> FlowFailure:
    """Every failure the branch collected, in one rejection the next turn
    can answer in full: a single failure keeps its own diagnostic verbatim,
    and several are listed under their own headed lines.

    The outcome is `TESTS_INVALID` as soon as any check found the tests
    invalid - a test that is both broken and passing is broken - and the
    sole failure's own outcome otherwise, so a branch whose only fault is
    that its tests pass is still `TESTS_DO_NOT_FAIL`."""
    if len(failed) == 1:
        return failed[0].failure
    outcome = (
        Outcome.TESTS_INVALID
        if any(verdict.failure.outcome is Outcome.TESTS_INVALID for verdict in failed)
        else failed[0].failure.outcome
    )
    # one gate run can reject on several steps at once, and the mechanic has
    # to answer each of them, so the count is of checks rather than of the
    # runs that reported them
    names = [name for verdict in failed for name in verdict.label.split(", ")]
    body = "\n\n".join(f"{verdict.label}:\n{verdict.failure.why}" for verdict in failed)
    return FlowFailure(
        outcome,
        f"{len(names)} of block 1's checks rejected the acceptance tests "
        f"({', '.join(names)}); this one correction must answer all {len(names)}, "
        f"because the next one is judged by all of them again:\n\n{body}",
        story_number,
    )


def _workflow_verdict(path, story_number: int, changed: list[str]) -> _Verdict:
    names = gates.workflow_gate_names(changed)
    failure = gates.run_workflow_gates(path, story_number, changed)
    if failure is None:
        return _Verdict("workflow gates", tuple(f"{name} ✔" for name in names))
    label = failure.headline.split(" failed")[0] or "workflow gates"
    return _Verdict(
        label,
        (f"{label} ✗",),
        FlowFailure(Outcome.TESTS_INVALID, failure.diagnostic, story_number),
    )


def validate_repaired_tests(
    slug: str,
    path: Path,
    base: str,
    layer: str,
    test_files: list[str],
    test_kind: str,
    story_number: int,
    named: list[str],
    objected_to: list[str],
) -> tuple[list[str], dict[str, int], str]:
    """Block 1's own verdict on a set of acceptance tests it repaired after
    an implementer's verified objection (steps/objection.py), taken in the
    driver-owned repair worktree: the same content, kind, gate and failure
    checks a first writing faces. Returns the acceptance set the repair
    leaves behind, the freeze's note about whichever of those tests already
    pass on the base, and the type debt that set carries, which replaces the
    rejected set's: the tests block 3 is now judged against are these, and
    `tests_type_debt` is how block 3 tells "the implementation has not
    provided the signature yet" from "block 1 accepted a broken test".

    `test_files` is the whole slice's acceptance set - the frozen files and
    whatever the reply named, not the reply's list alone - because a repair
    answers one objection and the other files keep judging the slice. It is
    `named` that says which of them the repair claims to have touched, and
    `objected_to` which tests it was allowed to touch at all.

    Two things differ from a first writing, and only two. The diff is
    measured against the slice's failing-test base rather than
    `origin/main`, because a dependent UI slice's base already carries its
    domain sibling and none of that is this repair's doing; and nothing is
    pushed, because the repair branch is the driver's own - it merges the
    commit into the slice's branch and pushes that."""
    if not worktrees.is_clean(path):
        raise FlowFailure(
            Outcome.TESTS_NOT_PUSHED, f"tree not clean on repair branch {slug}", story_number
        )
    if not named:
        raise FlowFailure(Outcome.TESTS_NOT_PUSHED, "mechanic reported no test files", story_number)
    _check_repaired_files_exist(slug, path, named, story_number)
    _check_the_repair_kept_the_unnamed_tests(
        slug, path, base, test_files, objected_to, story_number
    )
    kept = [test_file for test_file in test_files if (path / test_file).exists()]
    changed = worktrees.changed_between(path, base)
    _check_the_repair_touched_the_tests(slug, changed, named, story_number)
    _check_every_changed_file_is_test_side(slug, layer, changed, story_number)
    _check_files_match_test_kind(slug, layer, changed, kept, test_kind, story_number)
    _check_test_quality(slug, path, kept, story_number)
    checks = _branch_checks(layer, story_number, path, kept, changed)
    debt = _judged(checks, story_number)
    narrate.line(
        f"🔍 Verify #{story_number} repair: tree clean ✔ · only tests ✔ · "
        + _branch_gate_summary(layer, changed, placement=False)
        + f" · {_ACCEPTANCE} ✔"
    )
    return kept, debt, _passing_note(checks)


def _check_the_repair_kept_the_unnamed_tests(
    slug: str,
    path: Path,
    base: str,
    test_files: list[str],
    objected_to: list[str],
    story_number: int,
) -> None:
    """A repair answers an objection; it does not shrink the slice.

    The objection names what it rejects as a whole file or as
    `<file>::<title>`, and that naming is the repair's whole warrant: it may
    rewrite or delete what was named and nothing else. #422 run 4 is why
    the rule is checked rather than only written in the brief - told that
    the type errors in an acceptance file it had not touched were "outside
    the acceptance tests", the mechanic deleted that file's describe block,
    five acceptance criteria with it, and the tests then passed with no
    implementation at all.

    The granularity is the file's own source: a deleted file is refused
    outright, and a file whose source still reads as tests is compared
    title by title against the same file at the slice's failing-test base.
    A title a runner builds rather than spells is invisible to that reading
    (acceptance.test_titles), so a file no title could be read from is
    judged whole - deleted or emptied of every `it`/`test` block - and its
    surviving tests are taken on trust."""
    whole_files = [item for item in objected_to if "::" not in item]
    for test_file in test_files:
        if acceptance.owning_test(test_file, whole_files) is not None:
            continue
        removed = _removed_tests(path, base, test_file, objected_to)
        if removed:
            raise FlowFailure(
                Outcome.TESTS_INVALID,
                f"the repair on {slug} removed acceptance tests the objection did not "
                f"name: {', '.join(removed)}; the objection names what may be rewritten "
                f"or dropped, and every other test of this slice still judges it",
                story_number,
            )


def _removed_tests(path: Path, base: str, test_file: str, objected_to: list[str]) -> list[str]:
    """Which tests of one acceptance file the repair took away without
    being asked to, named as the objection would have named them: the file
    itself when it is gone, and `<file>::<title>` for every title that was
    there at `base` and is not there now."""
    before = worktrees.content_at(path, base, test_file)
    if before is None:
        return []
    if not (path / test_file).exists():
        return [test_file]
    was = acceptance.test_titles(test_file, before)
    now = set(acceptance.test_titles(test_file, (path / test_file).read_text()))
    named = {
        item.split("::", 1)[1]
        for item in objected_to
        if "::" in item and acceptance.matching_path(item.split("::", 1)[0], [test_file])
    }
    return [f"{test_file}::{title}" for title in was if title not in now and title not in named]


def _check_repaired_files_exist(slug: str, path, test_files: list[str], story_number: int) -> None:
    for test_file in test_files:
        if not (path / test_file).exists():
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED,
                f"{test_file} is not on repair branch {slug}",
                story_number,
            )


def _check_the_repair_touched_the_tests(
    slug: str, changed: list[str], test_files: list[str], story_number: int
) -> None:
    """A repair that changed nothing has not answered the objection; one
    that changed only files it does not name has not either."""
    if not any(test_file in changed for test_file in test_files):
        raise FlowFailure(
            Outcome.TESTS_INVALID,
            f"the repair on {slug} changed none of the acceptance tests it reports "
            f"({', '.join(test_files)}); the objection is about their content",
            story_number,
        )


def _check_test_quality(slug: str, path, test_files: list[str], story_number: int) -> None:
    """The acceptance tests become immutable implementation inputs, so their
    content must satisfy their own gates now: no lint suppressions, and a
    playwright spec must exercise the component through the harness route
    instead of importing product code in the browser context.

    Both rules read TypeScript, so a workflow slice's Python tests skip
    them: their equivalent is `ruff check workflow`, which the workflow
    gates run over the whole package, tests included."""
    for test_file in test_files:
        target = path / test_file
        if not target.exists() or test_file.endswith(".py"):
            continue
        for diagnostic in (
            acceptance.rejects_suppression(target),
            acceptance.rejects_browser_module_import(target),
        ):
            if diagnostic:
                raise FlowFailure(
                    Outcome.TESTS_INVALID, f"{diagnostic} (branch {slug})", story_number
                )


def _lint_verdict(path, test_files: list[str], story_number: int) -> _Verdict:
    """The acceptance tests' own change-scoped lint. A story that adds an
    export makes the type-aware rules see `any` flowing out of an import
    that does not resolve yet: #424's spec produced 186 `no-unsafe-*`
    errors and could not be written any other way. Those are accepted while
    they stay inside the acceptance files; every other rule is still the
    mechanic's to fix now."""
    failure = gates.run_changed_lint(path, story_number)
    if failure is None:
        return _Verdict("lint:changed", ("lint:changed ✔",))
    return _lane_verdict(
        failure, test_files, lanes.tolerated_lint_error, "lint:changed", "lint errors", story_number
    )


def _type_verdict(path, test_files: list[str], story_number: int) -> _Verdict:
    """A test that calls a helper with an argument of the wrong type throws
    instead of asserting, so it can never pass however the behavior is
    implemented (#399). The repository's own type lane sees that before the
    tests become immutable inputs.

    It also sees the story's new signature, which by construction does not
    exist yet: #423's tests called `toggleSet(exerciseIndex, setIndex)`
    against a one-argument method and the lane said so, three times, with
    no correction available that was not a suppression. A type error the
    implementation will answer, inside an acceptance file, is part of
    failing as intended; the runtime verdict below still has to hold."""
    failure = gates.run_type_check(path, story_number)
    if failure is None:
        return _Verdict("check", ("check ✔",))
    return _lane_verdict(
        failure, test_files, lanes.tolerated_type_error, "check", "type errors", story_number
    )


def _lane_verdict(
    failure: gates.LaneFailure,
    test_files: list[str],
    tolerated,
    lane: str,
    noun: str,
    story_number: int,
) -> _Verdict:
    """Accept a lane failure that is entirely the story's missing API
    showing through the acceptance tests, and reject every other one."""
    debt = _missing_api_debt(failure.reading, test_files, tolerated)
    if debt is None:
        count = f" ({len(failure.reading.errors)} {noun})" if failure.reading.complete else ""
        return _Verdict(
            lane,
            (f"{lane} ✗{count}",),
            FlowFailure(
                Outcome.TESTS_INVALID,
                _why_not_the_missing_api(failure, test_files, tolerated, noun),
                story_number,
            ),
        )
    narrate.line(
        f"🧪 Gates: {lane} — {sum(debt.values())} {noun} inside the acceptance tests, "
        "expected before the implementation exists ✔"
    )
    return _Verdict(lane, (f"{lane} ✔",), debt=debt)


def _missing_api_debt(reading, test_files: list[str], tolerated) -> dict[str, int] | None:
    """How many tolerated errors each acceptance file carries, or None the
    moment the lane reported anything else: an error outside the acceptance
    files, a rule the implementation will not answer, or output the driver
    could not read in full.

    A shared helper under `tests/` is outside the acceptance files, so a
    lint or type error inside one is never tolerated debt. Nothing there is
    waiting for an API the story has not written yet - the helper carries
    setup the suites already run - so it has to compile and lint on its own
    today, and the writer that moved code into it owns that."""
    if not reading.complete:
        return None
    debt: dict[str, int] = {}
    for error in reading.errors:
        owner = acceptance.owning_test(error.file, test_files)
        if owner is None or not tolerated(error):
            return None
        debt[owner] = debt.get(owner, 0) + 1
    return debt or None


def _why_not_the_missing_api(
    failure: gates.LaneFailure, test_files: list[str], tolerated, noun: str
) -> str:
    """Why the driver rejected the branch, and then the lane's own
    diagnostic: which part of the output is the mechanic's to fix - the
    errors outside the acceptance tests, or the rules no implementation
    will answer.

    The driver's sentence comes first because the first line of a
    `FlowFailure` is its headline, in the log and in the next turn's brief.
    It used to come last, after the checker's own truncated output, and
    #422 run 4 is what the mechanic then read: a headline ending
    `/src/lib/domain/workout")'."` and no sign of the reason until eleven
    lines further down."""
    if not failure.reading.complete:
        return failure.diagnostic
    outside = sorted(
        {
            error.file
            for error in failure.reading.errors
            if acceptance.owning_test(error.file, test_files) is None
        }
    )
    if outside:
        return (
            f"{noun} outside the acceptance tests, where this branch may not change "
            f"anything: {', '.join(outside)}\n{failure.diagnostic}"
        )
    rejected = sorted(
        {error.described() for error in failure.reading.errors if not tolerated(error)}
    )
    return (
        f"{noun} the implementation will not make go away, so fix them here: "
        f"{'; '.join(rejected[:3])}\n{failure.diagnostic}"
    )


def _content_verdict(path, test_files: list[str], story_number: int) -> _Verdict:
    """Block 3 judges the implementation with the repository gate, and the
    acceptance tests are part of the diff it sizes: a clone, a formatting
    miss or a suppression inside a test file fails that gate on every
    implementation attempt, and by then the test's bytes are immutable and
    nobody can repair them (#397). The same steps run here, where the
    mechanic still owns the file and the failure is an ordinary
    correction.

    They size the branch's own diff rather than the reported acceptance
    set, so a shared helper under `tests/` that the tests lifted their
    setup into is judged by them too - which is the point: an edit there
    can break a suite this slice never looked at, and `duplicates`,
    `format:check`, `check:suppressions` and `spellcheck` read it exactly
    as they read the tests. `lint:changed` is the branch diff as well, and
    `check` types the whole tree."""
    failure = gates.run_failing_branch_steps(path, story_number)
    if failure is None:
        return _Verdict("content steps", (", ".join(gates.FAILING_BRANCH_STEPS) + " ✔",))
    words = _unknown_words(failure.diagnostic, test_files)
    return _Verdict(
        ", ".join(sorted(failure.steps)) or "content steps",
        tuple(
            f"{step} ✗{_step_detail(step, words)}"
            for step in gates.FAILING_BRANCH_STEPS
            if step in failure.steps
        ),
        FlowFailure(
            Outcome.TESTS_INVALID, failure.diagnostic + _spelling_guidance(words), story_number
        ),
    )


#: cspell's own issue line inside a failed `spellcheck` step's detail: the
#: file it read, and the word it did not know.
_UNKNOWN_WORD = re.compile(r"^\s*([\w./@+-]+):\d+:\d+ - Unknown word \(([^)]+)\)")


def _unknown_words(diagnostic: str, test_files: list[str]) -> dict[str, int]:
    """Every word `spellcheck` rejected inside one of the acceptance tests,
    and how often - `{"LINDOR": 4}` for the fixture data #397's mechanic
    spent its last attempt on. A word cspell met in a file this branch did
    not write is not the mechanic's to fix, so it is not counted."""
    counts: dict[str, int] = {}
    for line in diagnostic.splitlines():
        match = _UNKNOWN_WORD.match(line)
        if match is not None and acceptance.owning_test(match.group(1), test_files) is not None:
            counts[match.group(2)] = counts.get(match.group(2), 0) + 1
    return counts


def _step_detail(step: str, words: dict[str, int]) -> str:
    """What the narrated union says in parentheses after a failed step. Only
    `spellcheck` has something that short and that useful to say."""
    if step != "spellcheck" or not words:
        return ""
    # the suppressed rule is about the multiplication sign the union line
    # deliberately uses after the word cspell rejected
    counted = ", ".join(f"{word} ×{count}" for word, count in sorted(words.items()))  # noqa: RUF001
    return f" ({counted})"


def _spelling_guidance(words: dict[str, int]) -> str:
    """What the writer can actually do about an unknown word inside a test
    file it owns. Not much, and saying so is the point: `cspell.json` is a
    workflow file this branch may not touch, and an inline `cspell:ignore`
    is not a way round it either - `scripts/quality/suppressions.ts` counts
    `cspell:ignore` and `cspell:disable` as suppressions and
    `quality/threshold-baseline.json` ratchets unjustified suppressions at
    0, so the directive would fail `check:suppressions` on the next run of
    these same steps. That leaves one option, and #397's `LINDOR` fixture
    is exactly the case: fixture data is invented, so invent it out of
    words the dictionary already knows."""
    if not words:
        return ""
    named = ", ".join(sorted(words))
    return (
        f"\ncspell does not know {named} inside the acceptance tests. Spell the fixture data "
        "with words the dictionary already knows - a fixture name is invented, so invent one "
        "cspell accepts - rather than keeping a real-world name it has never seen. You cannot "
        "add the word to `cspell.json` from this branch (only a workflow slice may change it), "
        "and an inline `cspell:ignore` comment is not an alternative: `check:suppressions` "
        "counts it as a suppression and the unjustified ratchet is 0, so it would fail these "
        "same steps on the next attempt."
    )


def _acceptance_verdict(path, test_files: list[str], story_number: int) -> _Verdict:
    """The acceptance run, as one more check in the union: the tests must
    run, fail, and fail on an expectation (#429). A tool failure still
    raises where it stands - it is not a verdict on the tests."""
    try:
        note = _verify_tests_fail(path, test_files, story_number)
    except FlowFailure as failure:
        return _Verdict(_ACCEPTANCE, (f"{_ACCEPTANCE} ✗",), failure)
    return _Verdict(_ACCEPTANCE, (f"{_ACCEPTANCE} ✔",), passing_note=note)


def _passing_note(verdicts: list[_Verdict]) -> str:
    """The acceptance run's note about tests that already pass, for the
    comment the freeze posts. Only the acceptance check carries one."""
    return next((verdict.passing_note for verdict in verdicts if verdict.passing_note), "")


def _check_failures_are_expectations(verdict, story_number: int) -> None:
    """Failing is not enough: each test must fail on an expectation waiting
    for the behavior. One that throws is broken, and no implementation can
    make it pass."""
    broken = verdict.defects
    if not broken:
        return
    raise FlowFailure(
        Outcome.TESTS_INVALID,
        "this test fails because it is broken, not because the feature is missing - "
        + failure_reason.describe(broken),
        story_number,
    )


def _check_reported_files_are_on_branch(
    slug: str, test_files: list[str], changed: list[str], story_number: int
) -> None:
    for changed_file in test_files:
        if changed_file not in changed:
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED, f"{changed_file} not found on branch {slug}", story_number
            )


def _check_every_changed_file_is_test_side(
    slug: str, layer: str, changed: list[str], story_number: int
) -> None:
    """Only test-side files may change here: the acceptance tests, and the
    shared test support they import. For a workflow slice the whole of
    `workflow/tests/` is test-side - a new flow scenario needs its
    `given_*` helper in `conftest.py` and often a scripted answer in a fake,
    and none of that is driver code. For a product slice the test support
    is the root `tests/` tree, and #337 run 5 is why it is in reach: the
    `duplicates` gate reads the e2e files, so setup repeated across them
    has to move into a helper there, and a writer forbidden the helpers
    could not answer the gate at all (acceptance.is_test_support).

    The support files are branch content, not acceptance bytes: they are
    never added to `test_files`, so block 3 may edit them like any other
    file it has in reach. Everything else - `src/`, `scripts/`,
    configuration - is refused with the same diagnostic as before."""
    for changed_file in changed:
        if not acceptance.is_test_side(layer, changed_file):
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED,
                f"non-test file changed on {slug}: {changed_file}",
                story_number,
            )


def _check_files_match_test_kind(
    slug: str,
    layer: str,
    changed: list[str],
    test_files: list[str],
    test_kind: str,
    story_number: int,
) -> None:
    """The kind rule is about the tests: a shared helper under `tests/` is
    of no runner's kind - `tests/e2e-support.ts` is imported by playwright
    specs and named like none of them - so the changed-file rule skips it.
    Reporting one as an acceptance test is still refused below: no runner
    collects a test from it."""
    mismatched = [
        path
        for path in changed
        if not acceptance.is_test_support(layer, path)
        and not acceptance.matches_test_kind(test_kind, path)
    ]
    if mismatched:
        raise FlowFailure(
            Outcome.TESTS_NOT_PUSHED,
            f"{test_kind} slice changed wrong-kind test on {slug}: {mismatched[0]}",
            story_number,
        )
    uncollected = [
        path for path in test_files if not acceptance.names_an_acceptance_test(test_kind, path)
    ]
    if uncollected:
        raise FlowFailure(
            Outcome.TESTS_NOT_PUSHED,
            f"{test_kind} slice reported {uncollected[0]} as an acceptance test on {slug}, "
            "and the runner collects no test from it",
            story_number,
        )


#: Where each kind of acceptance test must live, and why.
#:
#: `playwright.config.ts` sets no `testDir` - its `testMatch` is
#: `**/*.e2e.{ts,js}` from the repository root - so playwright itself accepts
#: an `*.e2e.ts` anywhere. The binding constraint is the coverage lane:
#: `test:coverage:client` in package.json includes `src/lib/**/*.{ts,svelte}`
#: as source and excludes only `src/**/*.{test,spec}.{js,ts}`, so an
#: `*.e2e.ts` under `src/lib/` is counted as a source file that no unit test
#: ever loads - 0% lines against a per-file threshold of 80%. Every
#: `*.e2e.ts` in the repository lives under `src/routes/`, and that is the
#: rule. #397's UI slice put one in `src/lib/components/`, block 3's
#: `verify:changed` never ran coverage, and CI failed deterministically on
#: the pull request where nobody could repair the file any more.
_E2E_DIR = "src/routes/"

#: A vitest spec is named after the module it covers and sits beside it, so
#: it lives under `src/` like that module. `src/lib/foo.ts` ->
#: `src/lib/foo.spec.ts`, a component -> `foo.svelte.spec.ts`.
_SPEC_DIR = "src/"


def _check_test_files_are_where_they_belong(
    slug: str, layer: str, changed: list[str], story_number: int
) -> None:
    """Placement, not naming: a test in the wrong folder can pass every gate
    block 1 runs and still fail CI on the pull request.

    Both rules read the repository's TypeScript layout - the coverage lane's
    view of `src/` - so a workflow slice is exempt: its own placement rule is
    enforced above, where `workflow/tests/**` is the only tree it may change
    and only a `test_*.py` inside it may be reported as an acceptance test.

    Shared test support is exempt for the same reason in reverse: `tests/`
    is where the repository already keeps its helpers, so a file there is
    in the folder it belongs in and neither rule has anything to say
    about it."""
    if layer == "workflow":
        return
    for changed_file in changed:
        if acceptance.is_test_support(layer, changed_file):
            continue
        expected = _misplaced(changed_file)
        if expected is not None:
            raise FlowFailure(
                Outcome.TESTS_INVALID,
                f"{changed_file} is in the wrong folder on {slug}: {expected}",
                story_number,
            )


def _misplaced(changed_file: str) -> str | None:
    """Why this test file's folder is wrong, or None when it belongs."""
    if changed_file.endswith(".e2e.ts"):
        if changed_file.startswith(_E2E_DIR):
            return None
        return (
            f"a playwright acceptance test must live under {_E2E_DIR} - the coverage "
            f"lane counts an .e2e.ts anywhere else under src/ as uncovered source; "
            f"move it to {_E2E_DIR}{PurePosixPath(changed_file).name}"
        )
    if not changed_file.startswith(_SPEC_DIR):
        return (
            f"a vitest spec must sit next to the module it covers, under {_SPEC_DIR} "
            "(foo.ts -> foo.spec.ts, a component -> foo.svelte.spec.ts)"
        )
    return None


def _verify_tests_fail(path, test_files: list[str], story_number: int) -> str:
    """The acceptance run block 1 freezes on, and what it says about the
    tests that passed in it."""
    for test_file in test_files:
        if not test_file.endswith((".e2e.ts", ".py")):
            diagnostic = acceptance.rejects_local_stand_in(path / test_file)
            if diagnostic:
                raise FlowFailure(Outcome.TESTS_DO_NOT_FAIL, diagnostic, story_number)
    verdict = acceptance.run_and_check_failing(path, test_files)
    if not verdict.ok:
        if not verdict.repairable:
            raise RuntimeError(verdict.why)
        raise FlowFailure(Outcome.TESTS_DO_NOT_FAIL, verdict.why, story_number)
    narrate.line(f"🧪 {', '.join(test_files)} → failed, as it should ✔")
    _check_failures_are_expectations(verdict, story_number)
    return _note_tests_that_already_pass(verdict)


def _note_tests_that_already_pass(verdict) -> str:
    """Narrate what this run says about the acceptance tests that pass on
    the base, and return the same line for the freeze's comment; "" when
    every one of them fails.

    "Fails as intended" is asked of the set, and one failing test answers
    it for the whole file - so #337 run 6 froze four acceptance tests of
    which three had passed since #341 and #347 landed, and nobody was told.
    Tests like those are worth keeping: they guard behavior that already
    exists. They are not acceptance criteria for this slice, and naming
    them at the freeze is how the difference stays visible - to Gabriel on
    the issue, and to the implementer reading the log. It is a line, not a
    gate: nothing stops."""
    passing = acceptance.already_passing(verdict)
    if not passing:
        return ""
    note = (
        f"⚠️ {len(passing)} of {len(verdict.statuses)} acceptance tests already pass on the "
        f"base: {', '.join(passing)} — they guard existing behavior and are not this "
        f"slice's work"
    )
    narrate.line(note)
    return note


def _comment(
    story_number: int,
    slug: str,
    path,
    test_files: list[str],
    why: str,
    ledger: "_Ledger",
    passing_note: str = "",
) -> None:
    sha = worktrees.local_head(path)
    written_by = f"Written by: {ledger.role}"
    if ledger.revision:
        written_by += f" (block 1 escalated {ledger.revision} rung(s) to reach it)"
    already = f"\n\n{passing_note}" if passing_note else ""
    body = (
        f"Branch: {slug}\nCommit: {sha}\nTest files: {', '.join(test_files)}\n"
        f"{written_by}\n\n"
        f"Why they fail: {why}{already}\n\nReady for block 2 (delegate)."
    )
    narrate.comment_posted(story_number, body)
    github.comment(story_number, body)
