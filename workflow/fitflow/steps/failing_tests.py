"""Box: mechanic writes failing acceptance tests - one worktree and one
mechanic turn per slice. The driver never trusts the reply: it verifies the
tree is clean, the branch is pushed, the reported files are the ones that
changed, every changed file is a test file, and only then runs them to
confirm they fail.
"""

import re

from fitflow import acceptance, agents, audit, github, narrate, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.slice import Slice

_TEST_FILE = re.compile(r"(\.spec\.ts|\.test\.ts|\.svelte\.spec\.ts|\.e2e\.ts)$")


def write_failing_tests(piece: Slice) -> None:
    slug = f"story-{piece.number}-{piece.layer}"
    if worktrees.slice_worktree_exists(slug):
        raise FlowFailure(
            Outcome.WORKTREE_EXISTS, f"worktree/branch '{slug}' already exists", piece.number
        )
    path = worktrees.create_slice_worktree(slug)
    audit.worktree_created(slug)
    narrate.line(f"🌿 Worktree {slug} · branch {slug}")
    agents.ensure_fresh_team(slug, path, piece.number)
    reply = agents.talk(
        slug,
        "mechanic",
        "failing_tests",
        "failing_tests",
        attribute_failures_to=piece.number,
        slice_number=piece.number,
        slice_title=piece.title,
        branch=slug,
        test_kind=piece.test_kind,
        brief=piece.brief,
        acceptance="\n".join(f"- {item}" for item in piece.acceptance),
    )
    test_files = list(reply["test_files"])
    narrate.fields(
        [
            ("Test files", ", ".join(test_files) or "(none)"),
            ("Why they fail", reply["why_they_fail"]),
        ]
    )
    _verify_pushed(slug, path, test_files, piece.number)
    _verify_tests_fail(path, test_files, piece.number)
    _comment(piece.number, slug, path, test_files, reply["why_they_fail"])


def _verify_pushed(slug: str, path, test_files: list[str], story_number: int) -> None:
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
    narrate.line(
        f"🔍 Verify #{story_number}: tree clean ✔ · pushed ✔ · files on branch ✔ · only tests ✔"
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
        if not _TEST_FILE.search(changed_file):
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED,
                f"non-test file changed on {slug}: {changed_file}",
                story_number,
            )


def _verify_tests_fail(path, test_files: list[str], story_number: int) -> None:
    ok, why = acceptance.run_and_check_failing(path, test_files)
    if not ok:
        raise FlowFailure(Outcome.TESTS_DO_NOT_FAIL, why, story_number)
    narrate.line(f"🧪 {', '.join(test_files)} → failed, as it should ✔")


def _comment(story_number: int, slug: str, path, test_files: list[str], why: str) -> None:
    sha = worktrees.local_head(path)
    body = (
        f"Branch: {slug}\nCommit: {sha}\nTest files: {', '.join(test_files)}\n\n"
        f"Why they fail: {why}\n\nReady for block 2 (delegate)."
    )
    narrate.comment_posted(story_number, body)
    github.comment(story_number, body)
