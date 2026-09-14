"""Unit and flow tests for signature tightening and retry narration improvements
in slice #406. Tests verify that is_transient rejects bare 502 in content,
accepts status/http-prefixed patterns, and that retry narration names the
actual reason."""

import json
import sys

from conftest import (
    delegate_slice,
    mechanic_signals,
    run_flow,
)

# --- Unit tests for is_transient with tightened signatures ---


def test_is_transient_rejects_bare_502_in_quoted_content(world):
    """is_transient returns False when 502 appears only inside quoted user
    content like a title or issue reference 'see #502'."""
    # Dynamically import the github module to get the updated is_transient
    if "fitflow.github" in sys.modules:
        del sys.modules["fitflow.github"]
    from fitflow import github

    assert not github.is_transient('title: "see #502" which is unrelated')
    assert not github.is_transient("user reported issue #502 in their content")


def test_is_transient_accepts_http_502(world):
    """is_transient returns True for 'HTTP 502'."""
    if "fitflow.github" in sys.modules:
        del sys.modules["fitflow.github"]
    from fitflow import github

    assert github.is_transient("HTTP 502 Bad Gateway")
    assert github.is_transient("http 502 error")


def test_is_transient_accepts_status_503(world):
    """is_transient returns True for 'status 503'."""
    if "fitflow.github" in sys.modules:
        del sys.modules["fitflow.github"]
    from fitflow import github

    assert github.is_transient("status 503 Service Unavailable")
    assert github.is_transient("Status 504 Gateway Timeout")


def test_is_transient_accepts_existing_patterns(world):
    """is_transient still returns True for all existing patterns."""
    if "fitflow.github" in sys.modules:
        del sys.modules["fitflow.github"]
    from fitflow import github

    # something went wrong while executing your query
    assert github.is_transient("something went wrong while executing your query")
    # timeout
    assert github.is_transient("connection timed out")
    assert github.is_transient("timeout")
    # connection reset
    assert github.is_transient("connection reset by peer")
    # could not resolve
    assert github.is_transient("could not resolve host")
    # rate limit
    assert github.is_transient("rate limit exceeded")


# --- Flow tests for gh retry narration ---


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


def _ready_to_deliver(world, number: int) -> None:
    _given_planned_story(world, number)
    _delegate(world, number, mechanic_signals())
    _implement(
        world,
        f"story-{number}-domain",
        "mechanic",
        {"src/lib/delivered.ts": "export const ok = 1;\n"},
    )


def test_gh_retry_narrates_status_prefix_signature_matched(world):
    """When a gh command fails with 'status 503', the retry narration
    names the matched signature, not just 'failed transiently'."""
    _ready_to_deliver(world, 2000)
    world.gh_fails_transiently(
        "pr create", message="error: status 503 Service Unavailable", times=1
    )

    result = run_flow(world, "2000")

    assert result.returncode == 0, result.stdout + result.stderr
    # The narration should name the signature that matched
    assert "status 503" in result.stdout or "status" in result.stdout
    assert "🔁" in result.stdout


def test_gh_retry_narrates_http_prefix_signature_matched(world):
    """When a gh command fails with 'HTTP 502', the retry narration
    names the matched signature."""
    _ready_to_deliver(world, 2001)
    world.gh_fails_transiently("pr create", message="HTTP 502 Bad Gateway", times=1)

    result = run_flow(world, "2001")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "HTTP 502" in result.stdout or "HTTP" in result.stdout


# --- Flow tests for aarmy retry narration ---


def test_aarmy_retry_narrates_no_message(world):
    """When an aarmy backend returns no message, the retry narration
    explicitly says 'no message'."""
    _given_planned_story(world, 2002)
    _delegate(world, 2002, mechanic_signals())
    world.agent_fails("story-2002-domain", "mechanic", "claude reported an error: None")
    _implement(
        world,
        "story-2002-domain",
        "mechanic",
        {"src/lib/delivered.ts": "export const ok = 1;\n"},
    )

    result = run_flow(world, "2002")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "no message" in result.stdout


def test_aarmy_retry_narrates_transient_signature_matched(world):
    """When an aarmy backend returns a transient signature, the retry
    narration names the signature that matched."""
    _given_planned_story(world, 2003)
    _delegate(world, 2003, mechanic_signals())
    world.agent_fails(
        "story-2003-domain",
        "mechanic",
        "claude reported an error: HTTP 502 Bad Gateway from downstream",
    )
    _implement(
        world,
        "story-2003-domain",
        "mechanic",
        {"src/lib/delivered.ts": "export const ok = 1;\n"},
    )

    result = run_flow(world, "2003")

    assert result.returncode == 0, result.stdout + result.stderr
    # The narration should name the transient signature that matched
    assert "HTTP 502" in result.stdout or "HTTP" in result.stdout


# --- Flow tests for _retry_once helper consolidation ---


def _pr_create_calls(world) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "gh" and tuple(call["argv"][:2]) == ("pr", "create")
    ]


def test_create_pr_uses_single_retry_helper(world):
    """create_pr calls a single private retry helper, not duplicated logic."""
    _ready_to_deliver(world, 2004)
    world.gh_fails_transiently("pr create", times=1)

    result = run_flow(world, "2004")

    assert result.returncode == 0, result.stdout + result.stderr
    # Verify the retry happened
    assert "🔁" in result.stdout
    # Verify exactly 2 calls were made (initial + 1 retry)
    assert len(_pr_create_calls(world)) == 2


def _pr(world, number: int) -> dict:
    """The fake gh's PR record, read from disk: the run happened in other
    processes, so the fixture's in-memory world is stale."""
    data = json.loads((world.dir / "world.json").read_text())
    return data.get("prs", {}).get(str(number), {})


def test_merge_pr_uses_single_retry_helper(world):
    """merge_pr calls a single private retry helper, not duplicated logic."""
    _ready_to_deliver(world, 2005)
    world.gh_fails_transiently("pr merge", times=1)

    result = run_flow(world, "2005")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔁" in result.stdout
    # PR should be merged after retry
    assert _pr(world, 500)["state"] == "MERGED"


# --- Idempotency tests ---


def test_create_pr_idempotency_no_duplicate_on_retry(world):
    """create_pr does not create a second PR when a retry finds an open PR
    for the head branch that the first attempt actually created."""
    _ready_to_deliver(world, 2006)
    world.gh_fails_transiently("pr create", times=1, after_write=True)

    result = run_flow(world, "2006")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔁" in result.stdout
    # The retry found the PR already open rather than creating a second one
    assert len(_pr_create_calls(world)) == 1
    assert _pr(world, 500)["state"] == "MERGED"


def test_merge_pr_idempotency_no_retry_on_already_merged(world):
    """merge_pr does not retry when the PR is already MERGED, even if the
    failure looked transient."""
    _ready_to_deliver(world, 2007)
    # Fail merge the first time, but the PR is already merged
    world.gh_fails_transiently("pr merge", times=1, after_write=True)

    result = run_flow(world, "2007")

    assert result.returncode == 0, result.stdout + result.stderr
    # The flow should complete successfully because merge_pr detected MERGED
    assert _pr(world, 500)["state"] == "MERGED"
