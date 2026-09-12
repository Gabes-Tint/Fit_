"""Exit codes for go.py, and the exception steps raise to stop the flow."""

from enum import IntEnum


class Outcome(IntEnum):
    """Every way a run can end. The value is the process exit code.

    Blocks 1-3 all end in this vocabulary: PLANNED (aliased as IMPLEMENTED)
    is the full run's success - planned, delegated, implemented and every
    slice gate passed - while 20-26 belong mostly to block 1, 27-29 to
    blocks 2-3 and 31 to block 1's acceptance-test defect gate."""

    PLANNED = 0
    IMPLEMENTED = 0  # alias: exit 0 after blocks 2-3 also pass
    NOTHING_TO_PICK = 10
    NEEDS_GABRIEL = 11
    CANNOT_PICK = 20
    AGENT_FAILED = 21
    AGENT_BROKE_CONTRACT = 22
    TESTS_NOT_PUSHED = 23
    TESTS_DO_NOT_FAIL = 24
    WORKTREE_EXISTS = 25
    TOOL_FAILED = 26
    PLAN_REJECTED = 27
    CAPACITY_EXHAUSTED = 28
    EXECUTION_HELD = 29
    RUN_STATE_CONFLICT = 30
    TESTS_INVALID = 31  # the acceptance tests themselves fail a validation


class FlowFailure(Exception):  # noqa: N818 - the flow's vocabulary word, not an Error
    """Raised by a step to stop the flow. cli.run() narrates and exits.

    story_number is None when the failure happens before a story is picked
    (NOTHING_TO_PICK, CANNOT_PICK) - there is nothing to comment on.

    add_blocked marks a terminal failure of blocks 2-3: the run also adds
    the `blocked` label to the story, because its slice resources
    (worktrees, branches, teams) are live and a fresh picker must not
    reuse them.
    """

    def __init__(
        self,
        outcome: Outcome,
        why: str,
        story_number: int | None = None,
        add_blocked: bool = False,
    ):
        super().__init__(why)
        self.outcome = outcome
        self.why = why
        self.story_number = story_number
        self.add_blocked = add_blocked
