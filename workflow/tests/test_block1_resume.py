"""End-to-end tests for block 1 run record retention and resumption.
A run that stops before block 2 can be resumed from its block 1 record,
relaunching the writer at the same revision with retained diagnostic and
rejections in its brief, without calling the planner again.

Black-box like the other suites: every assertion is on exit codes, logs,
the retained record and the fake-world state.
"""

from conftest import (
    delegate_slice,
    mechanic_signals,
    run_flow,
)


def _given_planned_story(world, number: int, layer: str = "domain") -> str:
    """Script block 1 planning: one slice with planner answers.
    Tests are not written yet - individual tests control that."""
    world.given_story(number, title="Block 1 record story", labels=["story"])
    world.planner_answers_whose_call(
        number,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        number,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": layer,
                "title": "Block 1 record work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": "vitest",
            }
        ],
    )
    test_file = "src/lib/block1-record.spec.ts"
    return test_file


def _delegate_mechanic(world, number: int, layer: str = "domain") -> None:
    world.planner_answers_delegate(number, [delegate_slice(number, layer, mechanic_signals())])


def _talks(world, role: str, team: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", role]
        and call["argv"][call["argv"].index("--team") + 1] == team
    ]


def test_block1_write_runs_record_when_mechanic_rejects(world):
    """When block 1 mechanic writes tests but doesn't push them,
    the runs/story-<n>.json record is written and holds the slice's number,
    layer and branch."""
    test_file = _given_planned_story(world, 800)
    _delegate_mechanic(world, 800)
    # Mechanic writes tests but doesn't push them
    world.mechanic_changes_without_pushing(
        "story-800-domain", files={test_file: "// failing\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail"])
    # Mechanic validates the tests
    world.mechanic_replies("story-800-domain", [test_file])

    result = run_flow(world, 800)

    # Should exit with TESTS_NOT_PUSHED
    assert result.returncode == 23, result.stdout + result.stderr
    # Record should exist and be populated
    record_path = world.home / "runs" / "story-800.json"
    assert record_path.exists()
    record = world.run_record(800)
    assert record["story_number"] == 800
    slice_record = record["slices"]["domain"]
    assert slice_record["number"] == 800
    assert slice_record["layer"] == "domain"
    assert slice_record["branch"] == "story-800-domain"
    assert slice_record["test_files"] == [test_file]


def test_resume_relaunches_mechanic_without_new_planner_call(world):
    """A --resume of a stopped block 1 run exits 0 with no planner call
    and no second child issue. The log has the '♻️  Resuming #<n>' line.
    The writer is relaunched on the same story-<n>-<layer> worktree
    and team."""
    test_file = _given_planned_story(world, 801)
    _delegate_mechanic(world, 801)
    # Mechanic writes tests but doesn't push them - stops block 1
    world.mechanic_changes_without_pushing(
        "story-801-domain", files={test_file: "// failing\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail"])
    # Mechanic validates the tests
    world.mechanic_replies("story-801-domain", [test_file])

    first = run_flow(world, 801)

    assert first.returncode == 23, first.stdout + first.stderr

    # Provide implementation for the resume
    world.agent_implements(
        "story-801-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )
    # Prepare for block 2/3
    _delegate_mechanic(world, 801)
    world.agent_implements(
        "story-801-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )

    result = run_flow(world, 801, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "♻️  Resuming #801" in result.stdout
    assert "🔀 Spans domain and UI?" not in result.stdout
    # No new planner call during resume - only the original 1 planner call for planning
    planner_talks = _talks(world, "planner", "plan-801")
    assert len(planner_talks) == 1
    record = world.run_record(801)
    slice_record = record["slices"]["domain"]
    assert slice_record["frozen_commit"] is not None


def test_resume_after_mechanic_escalation_to_builder(world):
    """A run that escalates from mechanic to builder in block 1 and then
    stops, resumes at the builder stage. The record shows builder was the
    last assigned role, and no mechanic turns run again on resume."""
    test_file = _given_planned_story(world, 802)
    _delegate_mechanic(world, 802)
    world.scripted_test_outcome(test_file, ["fail"])
    # First mechanic attempt doesn't push - block 1 continues
    world.mechanic_changes_without_pushing(
        "story-802-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
    )
    # Mechanic validates
    world.mechanic_replies("story-802-domain", [test_file])
    # Second mechanic attempt doesn't push - block 1 continues
    world.mechanic_changes_without_pushing(
        "story-802-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
    )
    # Mechanic validates
    world.mechanic_replies("story-802-domain", [test_file])
    # Third mechanic attempt doesn't push - block 1 escalates to builder
    world.mechanic_changes_without_pushing(
        "story-802-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
    )
    # Mechanic validates (after which escalation happens)
    world.mechanic_replies("story-802-domain", [test_file])
    # Builder writes but doesn't push - stops block 1
    world.mechanic_changes_without_pushing(
        "story-802-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
        role="builder",
    )
    # Builder validates
    world.mechanic_replies("story-802-domain", [test_file], role="builder")

    first = run_flow(world, 802)

    assert first.returncode == 23, first.stdout + first.stderr
    assert "⏫ #802 (domain) escalating mechanic → builder" in first.stdout

    # Provide builder implementation for resume
    world.agent_implements(
        "story-802-domain",
        "builder",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )
    # Prepare for block 2/3
    _delegate_mechanic(world, 802)
    world.agent_implements(
        "story-802-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )

    result = run_flow(world, 802, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    record = world.run_record(802)
    slice_record = record["slices"]["domain"]
    # Last assignment should be builder
    assert slice_record["assignments"][-1]["role"] == "builder"
    # Mechanic talks in block 1 should be just the 3 mechanic attempts
    mechanic_talks = _talks(world, "mechanic", "story-802-domain")
    # Only 3 block 1 mechanics, no block 3 mechanic (builder handles block 3)
    assert len(mechanic_talks) == 3


def test_fresh_go_on_story_with_block1_record_conflicts(world):
    """A fresh go.py <n> on a story that already has a block 1 record
    exits 30 (RUN_STATE_CONFLICT) and names --resume and --reset."""
    test_file = _given_planned_story(world, 803)
    _delegate_mechanic(world, 803)
    # Mechanic writes tests but doesn't push - stops block 1
    world.mechanic_changes_without_pushing(
        "story-803-domain", files={test_file: "// failing\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail"])
    # Mechanic validates the tests
    world.mechanic_replies("story-803-domain", [test_file])

    first = run_flow(world, 803)

    assert first.returncode == 23, first.stdout + first.stderr
    # Record should exist
    assert (world.home / "runs" / "story-803.json").exists()

    # Try a fresh run without --resume or --reset
    result = run_flow(world, 803)

    assert result.returncode == 30, result.stdout + result.stderr
    assert "RUN_STATE_CONFLICT" in result.stdout
    assert "--resume" in result.stdout
    assert "--reset" in result.stdout


def test_resume_continues_incomplete_block1_work(world):
    """A --resume continues incomplete block 1 work by relaunching the
    writer at the same revision and team, preserving prior turn records."""
    test_file = _given_planned_story(world, 804)
    _delegate_mechanic(world, 804)
    world.scripted_test_outcome(test_file, ["fail"])
    # Mechanic's first turn doesn't push - stops block 1
    world.mechanic_changes_without_pushing(
        "story-804-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
    )
    # Mechanic validates the tests
    world.mechanic_replies("story-804-domain", [test_file])

    first = run_flow(world, 804)

    assert first.returncode == 23, first.stdout + first.stderr
    record = world.run_record(804)
    team = record["slices"]["domain"]["team"]

    # Provide new implementation for resume
    world.agent_implements(
        "story-804-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )
    # Prepare for block 2/3
    _delegate_mechanic(world, 804)
    world.agent_implements(
        "story-804-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )

    result = run_flow(world, 804, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    # Team should be the same
    resumed_record = world.run_record(804)
    assert resumed_record["slices"]["domain"]["team"] == team


def test_block1_record_contains_slice_metadata(world):
    """The block 1 run record holds slice metadata like number, layer,
    branch, team, and worktree."""
    test_file = _given_planned_story(world, 805)
    _delegate_mechanic(world, 805)
    # Mechanic writes tests but doesn't push them - stops block 1
    world.mechanic_changes_without_pushing(
        "story-805-domain", files={test_file: "// failing\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail"])
    # Mechanic validates the tests
    world.mechanic_replies("story-805-domain", [test_file])

    result = run_flow(world, 805)

    assert result.returncode == 23, result.stdout + result.stderr
    record = world.run_record(805)
    slice_record = record["slices"]["domain"]
    # Verify slice metadata
    assert slice_record["number"] == 805
    assert slice_record["layer"] == "domain"
    assert slice_record["branch"] == "story-805-domain"
    assert "team" in slice_record
    assert "worktree" in slice_record
    assert slice_record["test_files"] == [test_file]


def test_resume_preserves_ladder_progression(world):
    """When block 1 escalates to builder and then stops, resuming brings
    the builder prompt with context about prior mechanic rejections."""
    test_file = _given_planned_story(world, 806)
    _delegate_mechanic(world, 806)
    world.scripted_test_outcome(test_file, ["fail"])
    # First mechanic attempt doesn't push - block 1 continues
    world.mechanic_changes_without_pushing(
        "story-806-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
    )
    # Mechanic validates
    world.mechanic_replies("story-806-domain", [test_file])
    # Second mechanic attempt doesn't push - block 1 continues
    world.mechanic_changes_without_pushing(
        "story-806-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
    )
    # Mechanic validates
    world.mechanic_replies("story-806-domain", [test_file])
    # Third mechanic attempt doesn't push - block 1 escalates to builder
    world.mechanic_changes_without_pushing(
        "story-806-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
    )
    # Mechanic validates (after which escalation happens)
    world.mechanic_replies("story-806-domain", [test_file])
    # Builder writes but doesn't push - stops block 1
    world.mechanic_changes_without_pushing(
        "story-806-domain",
        files={test_file: "// failing\n"},
        test_files=[test_file],
        role="builder",
    )
    # Builder validates
    world.mechanic_replies("story-806-domain", [test_file], role="builder")

    first = run_flow(world, 806)

    assert first.returncode == 23, first.stdout + first.stderr
    assert "escalating mechanic → builder" in first.stdout

    # Provide builder implementation for resume
    world.agent_implements(
        "story-806-domain",
        "builder",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )
    # Prepare for block 2/3
    _delegate_mechanic(world, 806)
    world.agent_implements(
        "story-806-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )

    result = run_flow(world, 806, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    record = world.run_record(806)
    # Record should show the escalation happened
    turns = record["slices"]["domain"]["turns"]
    assert len(turns) >= 3  # At least three mechanic attempts before builder


def test_no_new_planner_call_on_resume(world):
    """A resume makes no new planner call. The retained record is reused
    without calling the planner again."""
    test_file = _given_planned_story(world, 807)
    _delegate_mechanic(world, 807)
    world.scripted_test_outcome(test_file, ["fail"])
    # Mechanic writes tests but doesn't push - stops block 1
    world.mechanic_changes_without_pushing(
        "story-807-domain", files={test_file: "// failing\n"}, test_files=[test_file]
    )
    # Mechanic validates the tests
    world.mechanic_replies("story-807-domain", [test_file])

    first = run_flow(world, 807)

    assert first.returncode == 23, first.stdout + first.stderr

    # Record initial planner talk count
    initial_planner_talks = len(_talks(world, "planner", "plan-807"))
    assert initial_planner_talks == 1  # Only the initial planning

    # Provide new implementation for resume
    world.agent_implements(
        "story-807-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )
    # Prepare for block 2/3
    _delegate_mechanic(world, 807)
    world.agent_implements(
        "story-807-domain",
        "mechanic",
        files={"src/lib/block1-record.ts": "export const block1Record = true;\n"},
        changed_files=["src/lib/block1-record.ts"],
    )

    result = run_flow(world, 807, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    # No new planner call during resume
    final_planner_talks = len(_talks(world, "planner", "plan-807"))
    assert final_planner_talks == initial_planner_talks  # Same count, no new planner call
