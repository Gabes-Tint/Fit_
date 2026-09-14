"""End-to-end tests for block 1's run record: a run that stops before block 2
leaves `runs/story-<n>.json` behind, and `go.py <n> --resume` continues block 1
from it.

Black-box like test_resume_and_reset.py: a first run stops somewhere real
inside block 1 - the ladder test_pick_and_plan.py's #437 scenarios climb - and
a second invocation continues it. Every assertion is on exit codes, logs, the
retained record, the prompts the fake aarmy was sent and the fake-world state.
"""

import json
import os
import signal
import subprocess
import time

from conftest import delegate_slice, mechanic_signals, run_flow, start_flow

from fitflow import agents

TEST_FILE = "src/lib/block1-record.spec.ts"
IMPLEMENTATION = {"src/lib/block1-record.ts": "export const block1Record = true;\n"}
CHANGED = ["src/lib/block1-record.ts"]
LADDER = ("mechanic", "builder", "solver")


def _slug(number: int) -> str:
    return f"story-{number}-domain"


def _planner_plans(world, number: int) -> None:
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
                "title": "Block 1 record work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": "vitest",
            }
        ],
    )


def _given_planned_story(world, number: int) -> None:
    world.given_story(number, title="Block 1 record story", labels=["story"])
    _planner_plans(world, number)
    # block 1's acceptance run sees the tests fail, block 3's sees them pass
    world.scripted_test_outcome(TEST_FILE, ["fail", "pass"])


def _never_pushed(world, number: int, role: str, attempt: int) -> None:
    world.mechanic_changes_without_pushing(
        _slug(number),
        files={TEST_FILE: f"// {role} attempt {attempt}, never pushed\n"},
        test_files=[TEST_FILE],
        role=role,
    )


def _stopped_with_tests_never_pushed(world, number: int) -> None:
    """Every rung commits the tests and never pushes them. Each one stops
    early on its second identical rejection, the ladder climbs to the
    solver, and the solver's stop is the run's: TESTS_NOT_PUSHED."""
    _given_planned_story(world, number)
    for role in LADDER:
        for attempt in (1, 2):
            _never_pushed(world, number, role, attempt)
    result = run_flow(world, number)
    assert result.returncode == 23, result.stdout + result.stderr


def _stopped_after_the_builder_took_over(world, number: int) -> None:
    """The mechanic's budget ends on a repeated rejection, the builder takes
    over the tests, and the builder's first turn dies before it replies."""
    _given_planned_story(world, number)
    for attempt in (1, 2):
        _never_pushed(world, number, "mechanic", attempt)
    world.agent_fails(_slug(number), "builder", "provider unavailable")
    result = run_flow(world, number)
    assert result.returncode == 21, result.stdout + result.stderr
    assert "the builder takes over the tests" in result.stdout


def _pushes_the_tests_then_implements(world, number: int, writer: str) -> None:
    """What a resume needs after block 1: the relaunched writer pushes the
    tests, block 2 delegates to the mechanic and block 3's one turn passes."""
    world.mechanic_writes(
        _slug(number),
        files={TEST_FILE: f"// the {writer} pushed them on resume\n"},
        test_files=[TEST_FILE],
        role=writer,
    )
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", mechanic_signals())])
    world.agent_implements(_slug(number), "mechanic", files=IMPLEMENTATION, changed_files=CHANGED)


def _record(world, number: int) -> dict:
    path = world.home / "runs" / f"story-{number}.json"
    assert path.exists(), f"block 1 left no run record at {path}"
    return world.run_record(number)


def _option(call: dict, name: str) -> str:
    argv = call["argv"]
    return argv[argv.index(name) + 1] if name in argv else ""


def _talks(calls: list[dict], role: str, team: str, schema: str = "") -> list[dict]:
    """The `aarmy talk` calls to `role` on `team`; with `schema`, only the
    turns answering that schema - `failing_tests.json` is block 1's writer."""
    return [
        call
        for call in calls
        if call.get("tool") == "aarmy"
        and call["argv"][0:2] == ["talk", role]
        and _option(call, "--team") == team
        and _option(call, "--schema").endswith(schema)
    ]


def _issues(world) -> list[str]:
    return sorted(json.loads((world.dir / "world.json").read_text())["issues"])


def test_a_writer_that_never_pushes_leaves_a_block_1_record(world):
    _stopped_with_tests_never_pushed(world, 800)

    record = _record(world, 800)
    assert record["story_number"] == 800
    piece = record["slices"]["domain"]
    assert (piece["number"], piece["layer"], piece["branch"]) == (800, "domain", "story-800-domain")
    assert piece["team"] == "story-800-domain"
    assert piece["worktree"].endswith("story-800-domain")
    assert piece["title"] == "Block 1 record work"
    assert piece["brief"] == "Add the behavior the acceptance test names."
    assert piece["acceptance"] == ["The named behavior is observable."]
    assert piece["test_kind"] == "vitest"
    # nothing was frozen: no tests commit
    assert not piece["tests_sha"]
    # the rung and revision block 1 ended on
    assert (piece["tests_role"], piece["tests_revision"]) == ("solver", 2)


def test_resume_relaunches_the_writer_without_planning_again(world):
    _stopped_with_tests_never_pushed(world, 801)
    slug = _slug(801)
    team = _record(world, 801)["slices"]["domain"]["team"]
    issues = _issues(world)
    before = len(world.calls())
    _pushes_the_tests_then_implements(world, 801, "solver")

    result = run_flow(world, 801, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "♻️  Resuming #801" in result.stdout
    assert "🔀 Spans domain and UI?" not in result.stdout
    resumed = world.calls()[before:]
    # block 2's delegation is the only planner turn: nothing was planned again
    planner = _talks(resumed, "planner", "plan-801")
    assert [_option(call, "--schema").rsplit("/", 1)[-1] for call in planner] == ["delegate.json"]
    assert _issues(world) == issues
    # the recorded rung is relaunched, on the same team, with its diagnostic
    writers = _talks(resumed, "solver", slug, "failing_tests.json")
    assert len(writers) == 1
    assert "local HEAD not pushed on story-801-domain" in writers[0]["prompt"]
    assert "mechanic attempt 1 —" in writers[0]["prompt"]
    assert "builder attempt 1 —" in writers[0]["prompt"]
    for earlier in ("mechanic", "builder"):
        assert not _talks(resumed, earlier, slug, "failing_tests.json")
    piece = world.run_record(801)["slices"]["domain"]
    assert piece["team"] == team
    assert piece["tests_sha"]


def test_resume_after_the_ladder_climbed_continues_at_the_builder(world):
    _stopped_after_the_builder_took_over(world, 802)
    slug = _slug(802)
    piece = _record(world, 802)["slices"]["domain"]
    assert (piece["tests_role"], piece["tests_revision"]) == ("builder", 1)
    assert not piece["tests_sha"]
    before = len(world.calls())
    _pushes_the_tests_then_implements(world, 802, "builder")

    result = run_flow(world, 802, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    resumed = world.calls()[before:]
    builder = _talks(resumed, "builder", slug, "failing_tests.json")
    assert len(builder) == 1
    # every rejection so far reaches the builder's relaunched turn
    assert "mechanic attempt 1 — TESTS_NOT_PUSHED: local HEAD not pushed" in builder[0]["prompt"]
    assert "mechanic attempt 2 — TESTS_NOT_PUSHED: local HEAD not pushed" in builder[0]["prompt"]
    # no earlier rung runs again: the one mechanic turn is block 3's
    assert not _talks(resumed, "mechanic", slug, "failing_tests.json")
    assert len(_talks(resumed, "mechanic", slug)) == 1
    piece = world.run_record(802)["slices"]["domain"]
    assert (piece["tests_role"], piece["tests_revision"]) == ("builder", 1)
    assert piece["tests_sha"]


def test_a_fresh_run_on_a_story_with_a_block_1_record_conflicts(world):
    _stopped_with_tests_never_pushed(world, 803)
    _record(world, 803)
    # someone lifts the stopped run's hold: only the record says a run exists
    world.given_story(803, title="Block 1 record story", labels=["story"])
    _planner_plans(world, 803)
    before = len(world.calls())

    result = run_flow(world, 803)

    assert result.returncode == 30, result.stdout + result.stderr
    assert "RUN_STATE_CONFLICT" in result.stdout
    assert "--resume" in result.stdout
    assert "--reset" in result.stdout
    for role in LADDER:
        assert not _talks(world.calls()[before:], role, _slug(803), "failing_tests.json")
    # the retained record is the stopped run's, not a fresh one
    assert _record(world, 803)["slices"]["domain"]["tests_role"] == "solver"


def _await_a_live_turn(team: str, role: str, driver: subprocess.Popen | None = None) -> None:
    deadline = time.monotonic() + 60
    while not agents.turn_in_flight(team, role):
        if driver is not None and driver.poll() is not None:
            raise AssertionError(f"the driver exited {driver.returncode} before the {role} turn")
        if time.monotonic() > deadline:
            raise AssertionError(f"the {role} turn for {team} never reached the process table")
        time.sleep(0.01)


def test_resume_never_launches_a_block_1_writer_beside_one_still_running(world, tmp_path):
    _given_planned_story(world, 804)
    slug = _slug(804)
    # the mechanic's first turn waits for a peer that never comes, so the
    # driver is killed while block 1's writer is mid-turn
    world.mechanic_writes(
        slug, files={TEST_FILE: "// never finished\n"}, test_files=[TEST_FILE], rendezvous="none"
    )
    log = tmp_path / "killed-run.log"
    driver = start_flow(world, 804, log=log)
    try:
        _await_a_live_turn(slug, "mechanic", driver)
    finally:
        os.killpg(driver.pid, signal.SIGKILL)
        driver.wait()
    _record(world, 804)

    orphan = subprocess.Popen(
        ["bash", "-c", f'exec -a "aarmy talk mechanic --team {slug}" sleep 60']
    )
    try:
        _await_a_live_turn(slug, "mechanic")
        before = len(world.calls())
        result = run_flow(world, 804, "--resume")
        outlived_the_resume = orphan.poll() is None
    finally:
        orphan.kill()
        orphan.wait()

    assert outlived_the_resume, "the fake turn ended before the driver looked for it"
    assert result.returncode == 29, result.stdout + result.stderr
    assert "still running on this machine" in result.stdout
    assert not _talks(world.calls()[before:], "mechanic", slug)
