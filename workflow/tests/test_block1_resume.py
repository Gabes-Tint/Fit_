"""End-to-end tests for resuming block 1 from its retained record (#462).
A first run stops inside block 1 - its writers never push, or a writer
dies after an escalation - and a second invocation continues it or is
refused. Every assertion is on exit codes, logs, the retained record, the
agent calls and the fake-world state.
"""

import fcntl
import json
import subprocess
import time

from conftest import delegate_slice, mechanic_signals, run_flow

from fitflow import agents

TEST_FILE = "src/lib/block1.spec.ts"
IMPLEMENTATION = {"src/lib/block1.ts": "export const block1 = true;\n"}
NOT_PUSHED = "TESTS_NOT_PUSHED: tree not clean on story-{number}-domain"


def _given_one_slice(world, number: int) -> str:
    world.given_story(number, title="Block 1 resume story", labels=["story"])
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
                "layer": "domain",
                "title": "Block 1 resume work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": "vitest",
            }
        ],
    )
    return f"story-{number}-domain"


def _never_pushes(world, slug: str, role: str) -> None:
    """Two identical rejections: the role's budget ends early on the repeat."""
    for _ in range(2):
        world.mechanic_writes(
            slug,
            files={TEST_FILE: f"// {role}: never committed\n"},
            test_files=[TEST_FILE],
            commit=False,
            push=False,
            role=role,
        )


def _talks(world, role: str, team: str, schema: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call["argv"][0:2] == ["talk", role]
        and call["argv"][call["argv"].index("--team") + 1] == team
        and any(schema in arg for arg in call["argv"])
    ]


def _block1_talks(world, role: str, slug: str) -> list[dict]:
    return _talks(world, role, slug, "failing_tests.json")


def _slicing_turns(world, number: int) -> list[dict]:
    return _talks(world, "planner", f"plan-{number}", "slices.json")


def _stopped_with_no_tests_pushed(world, number: int) -> str:
    slug = _given_one_slice(world, number)
    for role in ("mechanic", "builder", "solver"):
        _never_pushes(world, slug, role)
    result = run_flow(world, number)
    assert result.returncode == 23, result.stdout + result.stderr
    return slug


def _stopped_after_the_builder_took_over(world, number: int) -> str:
    slug = _given_one_slice(world, number)
    _never_pushes(world, slug, "mechanic")
    world.agent_fails(slug, "builder", "provider unavailable")
    result = run_flow(world, number)
    assert result.returncode == 21, result.stdout + result.stderr
    return slug


def _finishes_after_block1(world, number: int, slug: str) -> None:
    """The resumed writer's pushed tests, then blocks 2 and 3."""
    world.scripted_test_outcome(TEST_FILE, ["fail", "pass"])
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", mechanic_signals())])
    world.agent_implements(
        slug, "mechanic", files=IMPLEMENTATION, changed_files=list(IMPLEMENTATION)
    )


def test_a_run_whose_writers_never_push_stops_23_and_retains_the_slice(world):
    slug = _stopped_with_no_tests_pushed(world, 710)

    piece = world.run_record(710)["slices"]["domain"]
    assert piece["number"] == 710
    assert piece["layer"] == "domain"
    assert piece["branch"] == slug
    assert piece["team"] == slug
    assert piece["worktree"] == str(world.slice_worktree_path(slug))
    assert piece["tests_sha"] == ""
    assert (piece["tests_role"], piece["tests_revision"]) == ("solver", 2)
    assert [entry["role"] for entry in piece["tests_rejections"]] == [
        "mechanic",
        "mechanic",
        "builder",
        "builder",
        "solver",
        "solver",
    ]


def test_resume_relaunches_the_writer_without_replanning(world):
    slug = _stopped_with_no_tests_pushed(world, 711)
    world._load()
    issues_before = set(world.world["issues"])
    next_issue_before = world.world["next_issue_number"]
    slicing_before = len(_slicing_turns(world, 711))
    worktree_before = world.run_record(711)["slices"]["domain"]["worktree"]
    world.mechanic_writes(
        slug, files={TEST_FILE: "// the solver's tests\n"}, test_files=[TEST_FILE], role="solver"
    )
    _finishes_after_block1(world, 711, slug)

    result = run_flow(world, 711, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "♻️  Resuming #711" in result.stdout
    assert "🔀 Spans domain and UI?" not in result.stdout
    assert len(_slicing_turns(world, 711)) == slicing_before
    world._load()
    assert set(world.world["issues"]) == issues_before
    assert world.world["next_issue_number"] == next_issue_before
    # the same worktree and team, not a fresh pair
    assert "🌿 Worktree" not in result.stdout
    assert f"♻️  Worktree {slug} · branch {slug} · team {slug}: reused" in result.stdout
    piece = world.run_record(711)["slices"]["domain"]
    assert piece["worktree"] == worktree_before
    assert piece["tests_sha"] != ""
    # one relaunch of the recorded role, told what the stopped run was told
    solver_turns = _block1_talks(world, "solver", slug)
    assert len(solver_turns) == 3
    assert NOT_PUSHED.format(number=711) in solver_turns[-1]["prompt"]


def test_resume_after_an_escalation_relaunches_the_builder_with_every_rejection(world):
    slug = _stopped_after_the_builder_took_over(world, 712)
    piece = world.run_record(712)["slices"]["domain"]
    assert (piece["tests_role"], piece["tests_revision"]) == ("builder", 1)
    assert len(_block1_talks(world, "mechanic", slug)) == 2
    world.mechanic_writes(
        slug, files={TEST_FILE: "// the builder's tests\n"}, test_files=[TEST_FILE], role="builder"
    )
    _finishes_after_block1(world, 712, slug)

    result = run_flow(world, 712, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    builder_turns = _block1_talks(world, "builder", slug)
    assert len(builder_turns) == 2  # the failed one, and one relaunch
    assert len(_block1_talks(world, "mechanic", slug)) == 2  # no mechanic block 1 turn
    handover = builder_turns[-1]["prompt"]
    rejection = NOT_PUSHED.format(number=712)
    assert f"1. mechanic attempt 1 — {rejection}" in handover
    assert f"2. mechanic attempt 2 — {rejection}" in handover
    assert world.run_record(712)["slices"]["domain"]["tests_role"] == "builder"


def _await_the_fake_turn(team: str, role: str) -> None:
    deadline = time.monotonic() + 5
    while not agents.turn_in_flight(team, role):
        if time.monotonic() > deadline:
            raise AssertionError(f"the fake {role} turn for {team} never reached the process table")
        time.sleep(0.01)


def test_resume_never_launches_a_writer_beside_one_still_running(world):
    slug = _stopped_after_the_builder_took_over(world, 713)
    orphan = subprocess.Popen(
        ["bash", "-c", f'exec -a "aarmy talk builder --team {slug}" sleep 60']
    )
    try:
        _await_the_fake_turn(slug, "builder")
        result = run_flow(world, 713, "--resume")
        outlived_the_resume = orphan.poll() is None
    finally:
        orphan.kill()
        orphan.wait()

    assert outlived_the_resume, "the fake turn ended before the driver looked for it"
    assert result.returncode == 29, result.stdout + result.stderr
    assert "a block 1 builder turn is still running on this machine" in result.stdout
    assert len(_block1_talks(world, "builder", slug)) == 1
    assert len(_block1_talks(world, "mechanic", slug)) == 2


def test_a_fresh_run_on_a_block1_record_runs_no_turn_at_all(world):
    slug = _stopped_with_no_tests_pushed(world, 714)
    record_before = world.run_record(714)
    calls_before = [call for call in world.calls() if call.get("tool") == "aarmy"]

    result = run_flow(world, 714)

    assert result.returncode == 30, result.stdout + result.stderr
    assert "--resume" in result.stdout and "--reset" in result.stdout
    assert [call for call in world.calls() if call.get("tool") == "aarmy"] == calls_before
    assert world.run_record(714) == record_before
    assert world.slice_worktree_path(slug).exists()


def test_a_fresh_run_beside_a_live_run_does_not_mark_the_story_blocked(world):
    """The record exists from block 1 on, so a live run has one too: a
    second `go.py <n>` is refused as held, not stopped as a conflict that
    labels the live story blocked and comments that it stopped."""
    _stopped_after_the_builder_took_over(world, 715)
    world._load()
    world.world["issues"]["715"]["labels"] = ["story", "in-progress"]
    world._save()
    comments_before = list(world.issue(715)["comments"])
    edits_before = world.label_edits(715)
    record_before = json.dumps(world.run_record(715), sort_keys=True)
    lock = world.home / "locks" / "story-715.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        result = run_flow(world, 715)

    assert result.returncode == 20, result.stdout + result.stderr
    assert "held by in-progress" in result.stdout
    assert "blocked" not in world.issue(715)["labels"]
    assert world.label_edits(715) == edits_before
    assert world.issue(715)["comments"] == comments_before
    assert json.dumps(world.run_record(715), sort_keys=True) == record_before
