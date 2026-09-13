"""Box: mechanics write failing acceptance tests.

The driver prepares slice worktrees and teams sequentially. Once all are
ready, it runs one mechanic per slice concurrently and waits for every result.
Each slice gets one initial turn and at most two repair turns in the same
session/worktree. The full independent validation runs after every turn.
"""

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
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
    turns,
    worktrees,
)
from fitflow.outcome import FlowFailure, Outcome
from fitflow.slice import Slice

_REPAIRABLE_OUTCOMES = {
    Outcome.TESTS_NOT_PUSHED,
    Outcome.TESTS_DO_NOT_FAIL,
    Outcome.TESTS_INVALID,
}


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


def write_failing_tests(slices: list[Slice], story_number: int) -> list[Slice]:
    prepared = [_prepare(piece) for piece in slices]
    if len(prepared) == 1:
        _run_mechanic(prepared[0])
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


def _prepare(piece: Slice) -> PreparedSlice:
    slug = f"story-{piece.number}-{piece.layer}"
    if worktrees.slice_worktree_exists(slug):
        raise FlowFailure(
            Outcome.WORKTREE_EXISTS, f"worktree/branch '{slug}' already exists", piece.number
        )
    path = worktrees.create_slice_worktree(slug)
    audit.worktree_created(slug)
    narrate.line(f"🌿 Worktree {slug} · branch {slug}")
    agents.ensure_fresh_team(slug, path, piece.number)
    return PreparedSlice(piece, slug, path)


def _run_parallel(prepared: list[PreparedSlice]) -> list[tuple[PreparedSlice, Exception]]:
    with ThreadPoolExecutor(max_workers=len(prepared), thread_name_prefix="fit-mechanic") as pool:
        futures = [(item, pool.submit(_run_mechanic, item)) for item in prepared]
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


def _run_mechanic(prepared: PreparedSlice) -> None:
    piece = prepared.piece

    def attempt_turn(attempt: int, diagnostic: str) -> None:
        with narrate.grouped():
            narrate.line(
                f"🔧 Mechanic #{piece.number} ({piece.layer}) attempt {attempt}/{turns.BUDGET}"
            )
        _run_attempt(prepared, attempt, diagnostic)

    turns.repair_loop(
        f"Mechanic #{piece.number}",
        attempt_turn,
        lambda failure: (
            failure.outcome in _REPAIRABLE_OUTCOMES and not isinstance(failure, ReasonedRefusal)
        ),
    )


def _run_attempt(prepared: PreparedSlice, attempt: int, diagnostic: str) -> None:
    piece, slug, path = prepared.piece, prepared.slug, prepared.path
    prompt = "failing_tests" if attempt == 1 else "correct_failing_tests"
    reply, _session = agents.talk(
        slug,
        "mechanic",
        prompt,
        "failing_tests",
        attribute_failures_to=piece.number,
        slice_number=piece.number,
        slice_title=piece.title,
        branch=slug,
        test_kind=piece.test_kind,
        brief=piece.brief,
        acceptance="\n".join(f"- {item}" for item in piece.acceptance),
        attempt=str(attempt - 1),
        diagnostic=diagnostic,
    )
    test_files = list(reply["test_files"])
    with narrate.grouped():
        narrate.line(f"📦 Mechanic result #{piece.number} ({piece.layer})")
        narrate.fields(
            [
                ("Test files", ", ".join(test_files) or "(none)"),
                ("Why they fail", reply["why_they_fail"]),
            ]
        )
    _check_not_a_reasoned_refusal(test_files, reply["why_they_fail"], piece.number)
    debt = _verify_pushed(prepared, test_files)
    _verify_tests_fail(path, test_files, piece.number)
    piece.test_files = list(test_files)
    piece.tests_type_debt = debt
    piece.commit = worktrees.local_head(path)
    _comment(piece.number, slug, path, test_files, reply["why_they_fail"])


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


def _verify_pushed(prepared: PreparedSlice, test_files: list[str]) -> dict[str, int]:
    """Every check the branch must pass before its bytes become immutable.
    Returns the type debt the acceptance tests carry: how many type and
    type-aware lint errors each one has because the API it calls does not
    exist yet. Block 3 reads it to tell "the implementation has not provided
    the signature yet" from "block 1 accepted a broken test"."""
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
    _check_every_changed_file_is_a_test(slug, piece.layer, changed, story_number)
    _check_files_match_test_kind(slug, changed, test_files, piece.test_kind, story_number)
    _check_test_files_are_where_they_belong(slug, piece.layer, changed, story_number)
    _check_test_quality(slug, path, test_files, story_number)
    debt = _check_failing_branch_gates(piece, path, test_files, changed)
    narrate.line(
        f"🔍 Verify #{story_number}: tree clean ✔ · pushed ✔ · files on branch ✔ · "
        "only tests ✔ · " + _branch_gate_summary(piece.layer, changed)
    )
    return debt


def _merged(first: dict[str, int], second: dict[str, int]) -> dict[str, int]:
    return {name: first.get(name, 0) + second.get(name, 0) for name in first | second}


def _branch_gate_summary(layer: str, changed: list[str]) -> str:
    if layer == "workflow":
        return " · ".join(f"{name} ✔" for name in gates.workflow_gate_names(changed))
    return "placed right ✔ · lint ✔ · types ✔ · " + ", ".join(gates.FAILING_BRANCH_STEPS) + " ✔"


def _check_failing_branch_gates(
    piece: Slice, path, test_files: list[str], changed: list[str]
) -> dict[str, int]:
    """The gates the acceptance tests must already pass, and the type debt
    the two type-aware lanes accepted. A workflow slice changes Python and
    prose, so the repository's TypeScript lanes have nothing to say about
    it and the driver's own four run instead - and a Python test names no
    TypeScript API, so such a slice never carries debt."""
    if piece.layer == "workflow":
        failure = gates.run_workflow_gates(path, piece.number, changed)
        if failure is not None:
            raise FlowFailure(Outcome.TESTS_INVALID, failure.diagnostic, piece.number)
        return {}
    debt = _check_failing_branch_lint(path, test_files, piece.number)
    debt = _merged(debt, _check_failing_branch_types(path, test_files, piece.number))
    _check_failing_branch_gate_steps(path, piece.number)
    return debt


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


def _check_failing_branch_lint(path, test_files: list[str], story_number: int) -> dict[str, int]:
    """The acceptance tests' own change-scoped lint. A story that adds an
    export makes the type-aware rules see `any` flowing out of an import
    that does not resolve yet: #424's spec produced 186 `no-unsafe-*`
    errors and could not be written any other way. Those are accepted while
    they stay inside the acceptance files; every other rule is still the
    mechanic's to fix now."""
    failure = gates.run_changed_lint(path, story_number)
    if failure is None:
        return {}
    return _accept_or_reject(
        failure, test_files, lanes.tolerated_lint_error, "lint:changed", "lint errors", story_number
    )


def _check_failing_branch_types(path, test_files: list[str], story_number: int) -> dict[str, int]:
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
        return {}
    return _accept_or_reject(
        failure, test_files, lanes.tolerated_type_error, "check", "type errors", story_number
    )


def _accept_or_reject(
    failure: gates.LaneFailure,
    test_files: list[str],
    tolerated,
    lane: str,
    noun: str,
    story_number: int,
) -> dict[str, int]:
    """Accept a lane failure that is entirely the story's missing API
    showing through the acceptance tests, and reject every other one."""
    debt = _missing_api_debt(failure.reading, test_files, tolerated)
    if debt is None:
        raise FlowFailure(
            Outcome.TESTS_INVALID,
            _why_not_the_missing_api(failure, test_files, tolerated),
            story_number,
        )
    narrate.line(
        f"🧪 Gates: {lane} — {sum(debt.values())} {noun} inside the acceptance tests, "
        "expected before the implementation exists ✔"
    )
    return debt


def _missing_api_debt(reading, test_files: list[str], tolerated) -> dict[str, int] | None:
    """How many tolerated errors each acceptance file carries, or None the
    moment the lane reported anything else: an error outside the acceptance
    files, a rule the implementation will not answer, or output the driver
    could not read in full."""
    if not reading.complete:
        return None
    debt: dict[str, int] = {}
    for error in reading.errors:
        owner = acceptance.owning_test(error.file, test_files)
        if owner is None or not tolerated(error):
            return None
        debt[owner] = debt.get(owner, 0) + 1
    return debt or None


def _why_not_the_missing_api(failure: gates.LaneFailure, test_files: list[str], tolerated) -> str:
    """The lane's own diagnostic, and - when the driver read the output in
    full - which part of it is the mechanic's to fix: the errors outside
    the acceptance tests, or the rules no implementation will answer."""
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
            f"{failure.diagnostic}\nthese errors are outside the acceptance tests, "
            f"where this branch may not change anything: {', '.join(outside)}"
        )
    rejected = sorted(
        {error.described() for error in failure.reading.errors if not tolerated(error)}
    )
    return (
        f"{failure.diagnostic}\nthe implementation will not make these go away, "
        f"so fix them here: {'; '.join(rejected[:3])}"
    )


def _check_failing_branch_gate_steps(path, story_number: int) -> None:
    """Block 3 judges the implementation with the repository gate, and the
    acceptance tests are part of the diff it sizes: a clone, a formatting
    miss or a suppression inside a test file fails that gate on every
    implementation attempt, and by then the test's bytes are immutable and
    nobody can repair them (#397). The same steps run here, where the
    mechanic still owns the file and the failure is an ordinary
    correction."""
    failure = gates.run_failing_branch_steps(path, story_number)
    if failure is not None:
        raise FlowFailure(Outcome.TESTS_INVALID, failure.diagnostic, story_number)


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


def _check_every_changed_file_is_a_test(
    slug: str, layer: str, changed: list[str], story_number: int
) -> None:
    """Only test-side files may change here. For a workflow slice the whole
    of `workflow/tests/` is test-side - a new flow scenario needs its
    `given_*` helper in `conftest.py` and often a scripted answer in a fake,
    and none of that is driver code."""
    for changed_file in changed:
        if not acceptance.is_test_file(layer, changed_file):
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED,
                f"non-test file changed on {slug}: {changed_file}",
                story_number,
            )


def _check_files_match_test_kind(
    slug: str, changed: list[str], test_files: list[str], test_kind: str, story_number: int
) -> None:
    mismatched = [path for path in changed if not acceptance.matches_test_kind(test_kind, path)]
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
    and only a `test_*.py` inside it may be reported as an acceptance test."""
    if layer == "workflow":
        return
    for changed_file in changed:
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


def _verify_tests_fail(path, test_files: list[str], story_number: int) -> None:
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


def _comment(story_number: int, slug: str, path, test_files: list[str], why: str) -> None:
    sha = worktrees.local_head(path)
    body = (
        f"Branch: {slug}\nCommit: {sha}\nTest files: {', '.join(test_files)}\n\n"
        f"Why they fail: {why}\n\nReady for block 2 (delegate)."
    )
    narrate.comment_posted(story_number, body)
    github.comment(story_number, body)
