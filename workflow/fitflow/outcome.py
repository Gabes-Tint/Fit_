"""Exit codes for go.py, and the exception steps raise to stop the flow."""

from enum import IntEnum


class Outcome(IntEnum):
    """Every way block 1 can end. The value is the process exit code."""

    PLANNED = 0
    NOTHING_TO_PICK = 10
    NEEDS_GABRIEL = 11
    CANNOT_PICK = 20
    AGENT_FAILED = 21
    AGENT_BROKE_CONTRACT = 22
    TESTS_NOT_PUSHED = 23
    TESTS_DO_NOT_FAIL = 24
    WORKTREE_EXISTS = 25
    TOOL_FAILED = 26


class FlowFailure(Exception):  # noqa: N818 - the flow's vocabulary word, not an Error
    """Raised by a step to stop the flow. cli.run() narrates and exits.

    story_number is None when the failure happens before a story is picked
    (NOTHING_TO_PICK, CANNOT_PICK) - there is nothing to comment on.
    """

    def __init__(self, outcome: Outcome, why: str, story_number: int | None = None):
        super().__init__(why)
        self.outcome = outcome
        self.why = why
        self.story_number = story_number
