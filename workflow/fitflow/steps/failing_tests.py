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
    narrate,
    turns,
    worktrees,
)
from fitflow.acceptance import TEST_FILE
from fitflow.outcome import FlowFailure, Outcome
from fitflow.slice import Slice

_REPAIRABLE_OUTCOMES = {
    Outcome.TESTS_NOT_PUSHED,
    Outcome.TESTS_DO_NOT_FAIL,
    Outcome.TESTS_INVALID,
}


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
        lambda failure: failure.outcome in _REPAIRABLE_OUTCOMES,
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
    _verify_pushed(slug, path, test_files, piece.test_kind, piece.number)
    _verify_tests_fail(path, test_files, piece.number)
    piece.test_files = list(test_files)
    piece.commit = worktrees.local_head(path)
    _comment(piece.number, slug, path, test_files, reply["why_they_fail"])


def _verify_pushed(
    slug: str, path, test_files: list[str], test_kind: str, story_number: int
) -> None:
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
    _check_every_changed_file_is_a_test(slug, changed, story_number)
    _check_files_match_test_kind(slug, changed, test_kind, story_number)
    _check_test_files_are_where_they_belong(slug, changed, story_number)
    _check_test_quality(slug, path, test_files, story_number)
    _check_failing_branch_lint(path, story_number)
    _check_failing_branch_types(path, story_number)
    _check_failing_branch_gate_steps(path, story_number)
    narrate.line(
        f"🔍 Verify #{story_number}: tree clean ✔ · pushed ✔ · files on branch ✔ · "
        "only tests ✔ · placed right ✔ · lint ✔ · types ✔ · "
        + ", ".join(gates.FAILING_BRANCH_STEPS)
        + " ✔"
    )


def _check_test_quality(slug: str, path, test_files: list[str], story_number: int) -> None:
    """The acceptance tests become immutable implementation inputs, so their
    content must satisfy their own gates now: no lint suppressions, and a
    playwright spec must exercise the component through the harness route
    instead of importing product code in the browser context."""
    for test_file in test_files:
        target = path / test_file
        if not target.exists():
            continue
        for diagnostic in (
            acceptance.rejects_suppression(target),
            acceptance.rejects_browser_module_import(target),
        ):
            if diagnostic:
                raise FlowFailure(
                    Outcome.TESTS_INVALID, f"{diagnostic} (branch {slug})", story_number
                )


def _check_failing_branch_lint(path, story_number: int) -> None:
    diagnostic = gates.run_changed_lint(path, story_number)
    if diagnostic is not None:
        raise FlowFailure(Outcome.TESTS_INVALID, diagnostic, story_number)


def _check_failing_branch_types(path, story_number: int) -> None:
    """A test that calls a helper with an argument of the wrong type throws
    instead of asserting, so it can never pass however the behavior is
    implemented (#399). The repository's own type lane sees that before the
    tests become immutable inputs."""
    diagnostic = gates.run_type_check(path, story_number)
    if diagnostic is not None:
        raise FlowFailure(Outcome.TESTS_INVALID, diagnostic, story_number)


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


def _check_every_changed_file_is_a_test(slug: str, changed: list[str], story_number: int) -> None:
    for changed_file in changed:
        if not TEST_FILE.search(changed_file):
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED,
                f"non-test file changed on {slug}: {changed_file}",
                story_number,
            )


def _check_files_match_test_kind(
    slug: str, changed: list[str], test_kind: str, story_number: int
) -> None:
    mismatched = [
        path for path in changed if path.endswith(".e2e.ts") != (test_kind == "playwright")
    ]
    if mismatched:
        raise FlowFailure(
            Outcome.TESTS_NOT_PUSHED,
            f"{test_kind} slice changed wrong-kind test on {slug}: {mismatched[0]}",
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
    slug: str, changed: list[str], story_number: int
) -> None:
    """Placement, not naming: a test in the wrong folder can pass every gate
    block 1 runs and still fail CI on the pull request."""
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
        if not test_file.endswith(".e2e.ts"):
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
