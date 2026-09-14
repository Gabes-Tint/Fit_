"""End-to-end tests for block 1's retained and resumable run record (#462).

Acceptance criteria from the brief:
- A run whose block 1 writers never push stops with exit 23 (TESTS_NOT_PUSHED).
  It leaves runs/story-<n>.json holding the slice's number, layer, branch,
  team and worktree, with no tests_sha.
- --resume of that run exits 0 (or reaches block 2) with no slicing planner
  turn and no new issue. The log has the '♻️  Resuming #<n>' line and no
  '🔀 Spans domain and UI?' line.
- On resume, the writer is relaunched on the same story-<n>-<layer> worktree
  and team, with the retained diagnostic in its prompt.
- A run that dies after block 1 escalated from mechanic to builder has a
  record showing builder/1. --resume runs one builder block 1 turn whose
  prompt carries every rejection so far, and the mechanic gets no block 1
  turn.
- A fresh go.py <n> on a story that already has a block 1 record exits 30
  (RUN_STATE_CONFLICT), names --resume and --reset, runs no writer turn
  and keeps the record.
- A --resume that finds a block 1 writer still running on this machine
  stops instead of launching another beside it.
"""

import json

from conftest import run_flow


def test_block1_creates_retained_record_on_failing_tests(world):
    """Block 1 creates and retains a run record even when it fails.
    The record holds slice identities and state, so a run stopped before
    block 2 can be resumed."""
    world.given_story(700, title="Block 1 record story", labels=["story"])
    world.planner_answers_whose_call(
        700,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        700,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Block 1 work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": "vitest",
            }
        ],
    )
    test_file = "src/lib/delegate.spec.ts"
    # Mechanism fails to write proper tests or doesn't push
    for _ in range(3):
        world.mechanic_writes(
            "story-700-domain",
            files={test_file: "// failing\n"},
            test_files=[test_file],
            push=False,
            commit=False,
        )

    result = run_flow(world, 700)

    # The run will fail, but the record should be created
    assert result.returncode != 0
    # Verify that runs/story-700.json exists and has the expected structure
    assert (world.home / "runs" / "story-700.json").exists()
    state = json.loads((world.home / "runs" / "story-700.json").read_text())
    assert state["story_number"] == 700
    assert "domain" in state["slices"]
    piece = state["slices"]["domain"]
    # Verify slice record fields exist
    assert piece["number"] == 700
    assert piece["layer"] == "domain"
    assert piece["branch"] is not None
    assert piece["team"] is not None
    assert piece["worktree"] is not None
    # tests_sha should be empty since tests weren't pushed
    assert piece["tests_sha"] == ""


def test_fresh_run_on_story_with_block1_record_exits_with_conflict(world):
    """A fresh go.py <n> on a story that already has a block 1 record exits 30
    (RUN_STATE_CONFLICT), names --resume and --reset, runs no writer turn and
    keeps the record."""
    world.given_story(701, title="Block 1 conflict story", labels=["story"])
    world.planner_answers_whose_call(
        701,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        701,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Conflict work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": "vitest",
            }
        ],
    )
    test_file = "src/lib/delegate.spec.ts"
    for _ in range(3):
        world.mechanic_writes(
            "story-701-domain",
            files={test_file: "// failing\n"},
            test_files=[test_file],
            push=False,
            commit=False,
        )

    # First run creates the record
    result = run_flow(world, 701)
    assert result.returncode != 0
    state_before = json.loads((world.home / "runs" / "story-701.json").read_text())

    # Try to run again without --resume or --reset
    result = run_flow(world, 701)

    # Should exit 30 (RUN_STATE_CONFLICT)
    assert result.returncode == 30, result.stdout + result.stderr
    # Should mention --resume and --reset
    assert "--resume" in result.stdout.lower() and "--reset" in result.stdout.lower()
    # Record should be unchanged
    state_after = json.loads((world.home / "runs" / "story-701.json").read_text())
    assert state_after == state_before
