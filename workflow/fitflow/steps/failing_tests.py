"""Box: mechanic writes failing acceptance tests - one mechanic turn per
slice, in that slice's own issue team (the story's team when the story was
not split, so the mechanic shares the worktree the planner already left
clean; a fresh child's team otherwise). The driver never trusts the reply:
it verifies the tree is clean, the branch is pushed, the reported files are
the ones that changed, every changed file is a test file, and only then
runs them to confirm they fail.
"""

import re

from fitflow import acceptance, agents, github, narrate, teams, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.slice import Slice

_TEST_FILE = re.compile(r"(\.spec\.ts|\.test\.ts|\.svelte\.spec\.ts|\.e2e\.ts)$")


def write_failing_tests(piece: Slice) -> None:
    team = teams.for_issue(piece.number)
    branch = team.name
    reply = agents.talk(
        team.name,
        "mechanic",
        "failing_tests",
        "failing_tests",
        attribute_failures_to=piece.number,
        slice_number=piece.number,
        slice_title=piece.title,
        branch=branch,
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
    _verify_pushed(branch, team.worktree, test_files, piece.number)
    _verify_tests_fail(team.worktree, test_files, piece.number)
    _comment(piece.number, branch, team.worktree, test_files, reply["why_they_fail"])


def _verify_pushed(branch: str, path, test_files: list[str], story_number: int) -> None:
    if not worktrees.is_clean(path):
        raise FlowFailure(Outcome.TESTS_NOT_PUSHED, f"tree not clean on {branch}", story_number)
    if worktrees.remote_head(branch) != worktrees.local_head(path):
        raise FlowFailure(
            Outcome.TESTS_NOT_PUSHED, f"local HEAD not pushed on {branch}", story_number
        )
    if not test_files:
        raise FlowFailure(Outcome.TESTS_NOT_PUSHED, "mechanic reported no test files", story_number)
    changed = worktrees.changed_files(path, branch)
    _check_reported_files_are_on_branch(branch, test_files, changed, story_number)
    _check_every_changed_file_is_a_test(branch, changed, story_number)
    narrate.line(
        f"🔍 Verify #{story_number}: tree clean ✔ · pushed ✔ · files on branch ✔ · only tests ✔"
    )


def _check_reported_files_are_on_branch(
    branch: str, test_files: list[str], changed: list[str], story_number: int
) -> None:
    for changed_file in test_files:
        if changed_file not in changed:
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED,
                f"{changed_file} not found on branch {branch}",
                story_number,
            )


def _check_every_changed_file_is_a_test(branch: str, changed: list[str], story_number: int) -> None:
    for changed_file in changed:
        if not _TEST_FILE.search(changed_file):
            raise FlowFailure(
                Outcome.TESTS_NOT_PUSHED,
                f"non-test file changed on {branch}: {changed_file}",
                story_number,
            )


def _verify_tests_fail(path, test_files: list[str], story_number: int) -> None:
    ok, why = acceptance.run_and_check_failing(path, test_files)
    if not ok:
        raise FlowFailure(Outcome.TESTS_DO_NOT_FAIL, why, story_number)
    narrate.line(f"🧪 {', '.join(test_files)} → failed, as it should ✔")


def _comment(story_number: int, branch: str, path, test_files: list[str], why: str) -> None:
    sha = worktrees.local_head(path)
    body = (
        f"Branch: {branch}\nCommit: {sha}\nTest files: {', '.join(test_files)}\n\n"
        f"Why they fail: {why}\n\nReady for block 2 (delegate)."
    )
    narrate.comment_posted(story_number, body)
    github.comment(story_number, body)
