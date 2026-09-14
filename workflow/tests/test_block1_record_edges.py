"""End-to-end tests for the edges of block 1's run record on a split story:
what `--reset` and a fresh run make of the record a stopped block 1 left,
and a run stopped after block 1 prepared a slice but before any writer
launched.

Black-box like test_resume_and_reset.py: every assertion is on exit codes,
logs, the retained record, the calls the fakes saw and the fake-world state.
"""

import json
import subprocess

from conftest import run_flow

DOMAIN, UI = "story-1000-domain", "story-1001-ui"
DOMAIN_TEST, UI_TEST = "src/lib/split.spec.ts", "src/routes/split.e2e.ts"


def _plans_a_split(world, number: int) -> None:
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
        spans_domain_and_ui=True,
        slices=[
            {
                "layer": "domain",
                "title": "Domain half",
                "brief": "Add the domain behavior.",
                "acceptance": ["The domain behavior is observable."],
                "test_kind": "vitest",
            },
            {
                "layer": "ui",
                "title": "UI half",
                "brief": "Show the UI behavior.",
                "acceptance": ["The UI behavior is visible at 360px."],
                "test_kind": "playwright",
            },
        ],
    )


def _given_split(world, number: int) -> None:
    world.given_story(number, title="Split record", labels=["story"])
    _plans_a_split(world, number)
    world.scripted_test_outcome(DOMAIN_TEST, ["fail", "pass"])
    world.scripted_test_outcome(UI_TEST, ["fail", "pass"])


def _stopped_by_a_ui_writer_failure(world, number: int) -> None:
    """Block 1 froze the domain slice's tests and the UI writer's first
    turn died: the run stops in block 1 with its record written."""
    _given_split(world, number)
    world.mechanic_writes(DOMAIN, files={DOMAIN_TEST: "// failing\n"}, test_files=[DOMAIN_TEST])
    world.mechanic_fails(UI, "down")
    result = run_flow(world, number)
    assert result.returncode == 21, result.stdout + result.stderr
    assert (world.home / "runs" / f"story-{number}.json").exists()


def _issues(world) -> list[str]:
    return sorted(json.loads((world.dir / "world.json").read_text())["issues"])


def _option(call: dict, name: str) -> str:
    argv = call["argv"]
    return argv[argv.index(name) + 1] if name in argv else ""


def _git(world, *args: str) -> None:
    subprocess.run(["git", *args], cwd=world.repo, check=True, capture_output=True)


def test_reset_after_block_1_stopped_undoes_the_run_from_its_record(world):
    _stopped_by_a_ui_writer_failure(world, 650)

    result = run_flow(world, 650, "--reset")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "from its retained record" in result.stdout
    assert world.issue(1000)["state"] == "CLOSED"
    assert world.issue(1001)["state"] == "CLOSED"
    assert world.issue(650)["state"] == "OPEN"
    assert not world.slice_worktree_path(DOMAIN).exists()
    assert not world.slice_worktree_path(UI).exists()
    assert not world.branch_exists_on_origin(DOMAIN)
    assert not (world.home / "runs" / "story-650.json").exists()
    assert len(world.archived_run_records(650)) == 1


def test_a_fresh_run_on_a_split_story_with_a_record_opens_no_child_issues(world):
    _stopped_by_a_ui_writer_failure(world, 651)
    issues = _issues(world)
    # someone lifts the stopped run's hold: only the record says a run exists
    world.given_story(651, title="Split record", labels=["story"])
    _plans_a_split(world, 651)

    result = run_flow(world, 651)

    assert result.returncode == 30, result.stdout + result.stderr
    assert "RUN_STATE_CONFLICT" in result.stdout
    assert "--resume" in result.stdout
    assert "--reset" in result.stdout
    assert "🔀 Spans domain and UI?" not in result.stdout
    assert _issues(world) == issues


def test_resume_reuses_a_slice_block_1_prepared_but_never_launched(world):
    _given_split(world, 652)
    # a UI branch this run never made stops block 1 after the domain slice's
    # worktree and team exist and before any writer launched
    _git(world, "worktree", "add", "-b", UI, str(world.slice_worktree_path(UI)), "origin/main")
    first = run_flow(world, 652)
    assert first.returncode == 25, first.stdout + first.stderr
    domain = world.run_record(652)["slices"]["domain"]
    assert (domain["tests_role"], domain["tests_attempts"]) == ("mechanic", 0)
    assert world.slice_worktree_path(DOMAIN).exists()

    # whoever owned the UI branch clears it away, and the run is resumed
    _git(world, "worktree", "remove", "--force", str(world.slice_worktree_path(UI)))
    _git(world, "branch", "-D", UI)
    world.mechanic_writes(DOMAIN, files={DOMAIN_TEST: "// failing\n"}, test_files=[DOMAIN_TEST])
    world.mechanic_writes(UI, files={UI_TEST: "// failing\n"}, test_files=[UI_TEST])
    before = len(world.calls())

    result = run_flow(world, 652, "--resume")

    assert "❌ WORKTREE_EXISTS" not in result.stdout, result.stdout + result.stderr
    slices = world.run_record(652)["slices"]
    assert slices["domain"]["tests_sha"] and slices["ui"]["tests_sha"]
    resumed = [call for call in world.calls()[before:] if call.get("tool") == "aarmy"]
    writers = [
        _option(call, "--team")
        for call in resumed
        if call["argv"][0:2] == ["talk", "mechanic"]
        and _option(call, "--schema").endswith("failing_tests.json")
    ]
    assert sorted(writers) == [DOMAIN, UI]
    # block 1 is done: the resumed run went on to block 2's delegation
    assert any(
        call["argv"][0:2] == ["talk", "planner"]
        and _option(call, "--schema").endswith("delegate.json")
        for call in resumed
    )
