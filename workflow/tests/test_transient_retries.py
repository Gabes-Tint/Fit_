"""End-to-end tests for the driver's one-retry policy on transient `gh`
and `aarmy` failures: a GitHub 5xx or an empty-message backend error gets
one retry after a short delay before the run stops, and the retry never
duplicates a write that actually landed. Black-box like the other suites:
every assertion is on go.py's exit code, its log, and the fake-world state
after the run.
"""

import json

from conftest import (
    delegate_slice,
    mechanic_signals,
    run_flow,
)


def _given_planned_story(world, number: int) -> None:
    """Block 1, scripted to completion: one domain slice, failing tests
    written, validated and pushed."""
    world.given_story(number, title="Retried story", labels=["story"])
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
                "title": "Retried work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": "vitest",
            }
        ],
    )
    slug = f"story-{number}-domain"
    test_file = "src/lib/retry.spec.ts"
    world.mechanic_writes(slug, files={test_file: "// failing\n"}, test_files=[test_file])
    world.scripted_test_outcome(test_file, ["fail", "pass"])


def _delegate(world, number: int, signals: dict) -> None:
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", signals)])


def _implement(world, slug: str, role: str, files: dict[str, str], **kwargs) -> None:
    world.agent_implements(slug, role, files=files, changed_files=sorted(files), **kwargs)


def _pr(world, number: int) -> dict:
    """The fake gh's PR record, read from disk: the run happened in other
    processes, so the fixture's in-memory world is stale."""
    data = json.loads((world.dir / "world.json").read_text())
    return data.get("prs", {}).get(str(number), {})


def _pr_create_calls(world) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "gh" and tuple(call["argv"][:2]) == ("pr", "create")
    ]


def _ready_to_deliver(world, number: int) -> None:
    _given_planned_story(world, number)
    _delegate(world, number, mechanic_signals())
    _implement(
        world,
        f"story-{number}-domain",
        "mechanic",
        {"src/lib/delivered.ts": "export const ok = 1;\n"},
    )


def test_pr_create_transient_failure_retries_once_and_succeeds(world):
    _ready_to_deliver(world, 1000)
    world.gh_fails_transiently("pr create", times=1)

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔁 gh pr create failed transiently, retrying once" in result.stdout
    assert _pr(world, 500)["state"] == "MERGED"
    assert len(_pr_create_calls(world)) == 2


def test_pr_create_transient_failure_twice_is_a_tool_failure(world):
    _ready_to_deliver(world, 1000)
    world.gh_fails_transiently("pr create", times=2)

    result = run_flow(world, "1000")

    assert result.returncode == 26, result.stdout + result.stderr
    assert "🔁 gh pr create failed transiently, retrying once" in result.stdout
    assert len(_pr_create_calls(world)) == 2
    assert not _pr(world, 500)


def test_pr_create_non_transient_failure_stops_immediately_without_retry(world):
    _ready_to_deliver(world, 1000)
    world.gh_fails_on("pr create")

    result = run_flow(world, "1000")

    assert result.returncode == 26, result.stdout + result.stderr
    assert "🔁" not in result.stdout
    assert len(_pr_create_calls(world)) == 1


def test_pr_create_retry_finds_the_pr_the_first_attempt_actually_opened(world):
    _ready_to_deliver(world, 1000)
    world.gh_fails_transiently("pr create", times=1, after_write=True)

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔁 gh pr create failed transiently, retrying once" in result.stdout
    # the retry found the PR already open rather than creating a second one
    assert len(_pr_create_calls(world)) == 1
    assert _pr(world, 500)["state"] == "MERGED"


def test_aarmy_empty_backend_error_retries_once_and_continues(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, mechanic_signals())
    world.agent_fails("story-1000-domain", "mechanic", "claude reported an error: None")
    _implement(
        world,
        "story-1000-domain",
        "mechanic",
        {"src/lib/delivered.ts": "export const ok = 1;\n"},
    )

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔁 mechanic backend error with no message, retrying once" in result.stdout
    assert _pr(world, 500)["state"] == "MERGED"


def test_aarmy_empty_backend_error_twice_is_agent_failed(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, mechanic_signals())
    world.agent_fails("story-1000-domain", "mechanic", "claude reported an error: None")
    world.agent_fails("story-1000-domain", "mechanic", "claude reported an error: None")

    result = run_flow(world, "1000")

    assert result.returncode == 21, result.stdout + result.stderr
    assert "🔁 mechanic backend error with no message, retrying once" in result.stdout


def test_narration_order_survives_a_redirected_log(world, tmp_path):
    """A run that stops as a tool failure narrates its `❌` line, then the
    `Stopped:` comment it posts on the story - in that order, even when
    stdout and stderr share one file descriptor as a shell redirect
    (`go.py > run.log 2>&1`) would. Stdout is block-buffered once
    redirected, and die()'s stderr copy is not, so without the fix
    the stderr copy lands in the file as soon as it is written while the
    equally-early stdout copy (and everything printed after it) waits for
    the buffer to flush - splicing `❌` into content the log had not yet
    received."""
    _ready_to_deliver(world, 1000)
    world.gh_fails_on("pr create")
    log_file = tmp_path / "run.log"

    result = run_flow(world, "1000", combined_log=log_file)

    assert result.returncode == 26
    lines = log_file.read_text().splitlines()
    comment_indexes = [i for i, line in enumerate(lines) if line.startswith("✏️")]
    die_indexes = [i for i, line in enumerate(lines) if line.startswith("❌")]
    assert comment_indexes, lines
    assert die_indexes, lines
    # die() runs first and posts the failure comment afterward, so the
    # final comment line - the run's very last narration - comes after it
    assert die_indexes[-1] < comment_indexes[-1]
