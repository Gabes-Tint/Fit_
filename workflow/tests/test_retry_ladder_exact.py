"""Exact regression checks for slice #406: the retry narration names the
matched signature, and merge_pr never re-runs a merge that already landed.
Shares the flow setup of test_signature_tightening.py."""

from conftest import mechanic_signals, run_flow
from test_signature_tightening import (
    _delegate,
    _given_planned_story,
    _implement,
    _ready_to_deliver,
)

from fitflow import github


def _gh_calls(world, subcommand: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "gh" and tuple(call["argv"][:2]) == ("pr", subcommand)
    ]


def test_transient_signature_names_the_matched_text():
    assert github.transient_signature("error: status 503 Service Unavailable") == "status 503"
    assert github.transient_signature('title: "see #502"') is None


def test_aarmy_retry_narration_names_the_exact_signature(world):
    _given_planned_story(world, 2100)
    _delegate(world, 2100, mechanic_signals())
    world.agent_fails(
        "story-2100-domain", "mechanic", "claude reported an error: HTTP 502 Bad Gateway"
    )
    _implement(
        world, "story-2100-domain", "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )

    result = run_flow(world, "2100")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔁 mechanic backend error matching 'HTTP 502', retrying once" in result.stdout


def test_gh_retry_narration_names_the_failure_line(world):
    _ready_to_deliver(world, 2101)
    world.gh_fails_transiently(
        "pr create", message="error: status 503 Service Unavailable", times=1
    )

    result = run_flow(world, "2101")

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "🔁 gh pr create failed transiently, retrying once: error: status 503 Service Unavailable"
        in result.stdout
    )


def test_merge_pr_already_merged_is_not_merged_twice(monkeypatch):
    """A transient merge failure that landed anyway is not merged again."""
    import subprocess

    calls = []

    def fake_gh(*args):
        calls.append(args)
        return subprocess.CompletedProcess(args, 1, "", "HTTP 502 Bad Gateway")

    monkeypatch.setattr(github, "_gh", fake_gh)
    monkeypatch.setattr(github.time, "sleep", lambda _: None)
    monkeypatch.setattr(
        github, "view_pr", lambda n: github.PullRequest(number=n, state="MERGED", head_ref="h")
    )

    github.merge_pr(500)

    assert calls == [("pr", "merge", "500")]
