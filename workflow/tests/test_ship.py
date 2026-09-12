"""End-to-end tests for block 5: the merge commit and its tag, main's own
CI, the QA deploy and its smoke report, the flaky decision, production,
the Android release and cleanup. Black-box like the other suites: the
assertions are go.py's exit code, the fake world's issues and worktrees,
and the exact `bun run deploy` invocations - argv, environment and the
checkout's head - because those are the contract with the real scripts.
"""

import json

from conftest import (
    PROD_HOST,
    PROD_ORIGIN,
    QA_HOST,
    QA_ORIGIN,
    mechanic_signals,
    run_flow,
)
from test_delivery import _delegate, _given_planned_story, _implement


def _shippable(world, number: int = 1000) -> None:
    """Block 1-4 scripted through to a mechanical merge."""
    _given_planned_story(world, number)
    _delegate(world, number, "domain", mechanic_signals())
    _implement(
        world,
        f"story-{number}-domain",
        "mechanic",
        {"src/lib/delivered.ts": "export const ok = 1;\n"},
    )


def _state(world) -> dict:
    path = world.dir / "world.json"
    return json.loads(path.read_text())


def _merge_sha(world, pr_number: int = 500) -> str:
    return _state(world)["prs"][str(pr_number)]["mergeCommit"]


def _bun_calls(world, script: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "bun" and call["argv"][:2] == ["run", script]
    ]


def _comments(world, number: int = 1000) -> list[str]:
    return world.issue(number)["comments"]


def _shipped_comment(world, number: int = 1000) -> str:
    shipped = [body for body in _comments(world, number) if body.startswith("Shipped:")]
    assert shipped, _comments(world, number)
    return shipped[-1]


def _ship_record(world, number: int = 1000) -> dict:
    state = json.loads((world.home / "runs" / f"story-{number}.json").read_text())
    return state["delivery"]["ship"], state["terminal"]


def test_a_full_ship_deploys_qa_then_production_and_builds_the_apk(world):
    _shippable(world)
    world.given_tag("v0.4.0")

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    merge_sha = _merge_sha(world)
    deploys = _bun_calls(world, "deploy")
    assert [call["argv"] for call in deploys] == [
        ["run", "deploy", "--tunnel"],
        ["run", "deploy"],
    ]
    assert deploys[0]["env"] == {
        "FIT_DEPLOY_HOST": QA_HOST,
        "FIT_PUBLIC_ORIGIN": QA_ORIGIN,
    }
    assert deploys[1]["env"] == {
        "FIT_DEPLOY_HOST": PROD_HOST,
        "FIT_PUBLIC_ORIGIN": PROD_ORIGIN,
    }
    # both deploys ran from a checkout at the commit that actually landed,
    # which is not the integration branch's head: main squashes
    assert [call["head"] for call in deploys] == [merge_sha, merge_sha]
    android = _bun_calls(world, "android:release")
    assert len(android) == 1
    assert f"--server-url={PROD_ORIGIN}" in android[0]["argv"]
    comment = _shipped_comment(world)
    assert "tag v0.4.0" in comment
    assert merge_sha[:12] in comment
    assert QA_ORIGIN in comment and PROD_ORIGIN in comment
    assert "app-release.apk" in comment


def test_the_record_carries_every_ship_result(world):
    _shippable(world)
    world.given_tag("v0.4.1")

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    ship, terminal = _ship_record(world)
    assert terminal == "SHIPPED"
    assert ship["merge_sha"] == _merge_sha(world)
    assert ship["tag"] == "v0.4.1"
    assert ship["main_ci"]["event"] == "push"
    assert ship["qa"]["ok"] is True
    assert ship["qa"]["origin"] == QA_ORIGIN
    assert ship["flaky"]["flaky"] is False
    assert ship["prod"]["ok"] is True
    assert ship["android"]["ok"] is True
    assert ship["android"]["sha256"]
    assert sorted(ship["cleanup"]["removed"]) == [
        "release-story-1000",
        "story-1000",
        "story-1000-domain",
    ]


def test_cleanup_removes_every_worktree_closes_the_child_and_unholds_the_story(world):
    _shippable(world)

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    for slug in ("story-1000-domain", "story-1000", "release-story-1000"):
        assert not world.slice_worktree_path(slug).exists(), slug
    gh_argv = [call["argv"] for call in world.calls() if call.get("tool") == "gh"]
    closed = [argv for argv in gh_argv if argv[:2] == ["issue", "close"]]
    assert len(closed) == 1
    assert "Delivered in PR #500 (tag v0.0.1)" in closed[0]
    assert ["issue", "edit", "1000", "--remove-label", "in-progress"] in [
        argv[:5] for argv in gh_argv
    ]
    assert "in-progress" not in world.issue(1000)["labels"]


def test_ship_to_qa_withholds_production_and_android(world):
    _shippable(world)

    result = run_flow(world, "1000", env_extra={"FIT_FLOW_SHIP_TO": "qa"})

    assert result.returncode == 0, result.stdout + result.stderr
    assert [call["argv"] for call in _bun_calls(world, "deploy")] == [["run", "deploy", "--tunnel"]]
    assert _bun_calls(world, "android:release") == []
    comment = _shipped_comment(world)
    assert "withheld by configuration" in comment
    assert "Android: skipped" in comment


def test_android_no_skips_the_apk_after_a_production_deploy(world):
    _shippable(world)

    result = run_flow(world, "1000", env_extra={"FIT_FLOW_ANDROID": "no"})

    assert result.returncode == 0, result.stdout + result.stderr
    assert len(_bun_calls(world, "deploy")) == 2
    assert _bun_calls(world, "android:release") == []
    assert "Android: skipped" in _shipped_comment(world)


def test_a_red_push_run_beside_a_green_merge_group_run_withholds_production(world):
    """`failOnFlakyTests`: a shard that only passed on its retry fails
    main's push run that the queue's run of the same commit never hit."""
    _shippable(world)
    world.given_main_ci(500, push="failure", merge_group="success")

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert [call["argv"] for call in _bun_calls(world, "deploy")] == [["run", "deploy", "--tunnel"]]
    comment = _shipped_comment(world)
    assert "withheld" in comment
    ship, _ = _ship_record(world)
    assert ship["flaky"]["flaky"] is True
    assert "merge_group" in ship["flaky"]["why"]


def test_an_end_to_end_job_in_the_counted_rerun_withholds_production(world):
    _shippable(world)
    world.given_checks(500, ["fail_e2e", "pass"])

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert [call["argv"] for call in _bun_calls(world, "deploy")] == [["run", "deploy", "--tunnel"]]
    ship, _ = _ship_record(world)
    assert ship["flaky"]["flaky"] is True
    assert "End-to-end" in ship["flaky"]["why"]


def test_a_push_run_still_going_at_the_deadline_withholds_production(world):
    _shippable(world)
    world.given_main_ci(500, push="running", merge_group="success")

    result = run_flow(world, "1000", env_extra={"FIT_FLOW_MAIN_CI_TIMEOUT": "0"})

    assert result.returncode == 0, result.stdout + result.stderr
    assert len(_bun_calls(world, "deploy")) == 1
    ship, _ = _ship_record(world)
    assert ship["flaky"]["flaky"] is True


def test_a_tag_that_never_appears_stops_before_any_deploy(world):
    _shippable(world)
    world.given_no_tag()

    result = run_flow(world, "1000", env_extra={"FIT_FLOW_MAIN_CI_TIMEOUT": "0"})

    assert result.returncode == 26, result.stdout + result.stderr
    assert _bun_calls(world, "deploy") == []
    assert any("version-tag.yml" in body for body in _comments(world))


def test_main_ci_red_for_the_merge_commit_stops_before_any_deploy(world):
    _shippable(world)
    world.given_main_ci(500, push="failure")

    result = run_flow(world, "1000")

    assert result.returncode == 26, result.stdout + result.stderr
    assert _bun_calls(world, "deploy") == []
    assert any("https://github.test/runs/7001" in body for body in _comments(world))


def test_a_qa_deploy_that_never_came_up_stops_with_needs_gabriel(world):
    _shippable(world)
    world.given_deploy("qa", "health_failed")

    result = run_flow(world, "1000")

    assert result.returncode == 32, result.stdout + result.stderr
    assert "needs-gabriel" in world.issue(1000)["labels"]
    assert "blocked" not in world.issue(1000)["labels"]
    assert len(_bun_calls(world, "deploy")) == 1
    assert any(QA_HOST in body for body in _comments(world))


def test_a_failed_qa_smoke_check_carries_its_failure_into_the_comment(world):
    _shippable(world)
    world.given_deploy("qa", "smoke_failed")

    result = run_flow(world, "1000")

    assert result.returncode == 32, result.stdout + result.stderr
    assert any("POST /api/sessions -> 500" in body for body in _comments(world))


def test_a_green_smoke_report_about_another_commit_is_not_a_deploy(world):
    """The exit code says shipped; only the report says which commit went
    live, and the driver is what reads it."""
    _shippable(world)
    world.given_deploy("qa", "wrong_release")

    result = run_flow(world, "1000")

    assert result.returncode == 32, result.stdout + result.stderr
    assert len(_bun_calls(world, "deploy")) == 1


def test_a_failed_production_deploy_says_qa_is_live(world):
    _shippable(world)
    world.given_deploy("prod", "smoke_failed")

    result = run_flow(world, "1000")

    assert result.returncode == 32, result.stdout + result.stderr
    assert "needs-gabriel" in world.issue(1000)["labels"]
    stopped = " ".join(_comments(world))
    assert QA_ORIGIN in stopped
    assert _bun_calls(world, "android:release") == []


def test_a_failed_android_build_is_reported_after_a_deploy_that_stands(world):
    _shippable(world)
    world.given_android("fail")

    result = run_flow(world, "1000")

    assert result.returncode == 26, result.stdout + result.stderr
    assert len(_bun_calls(world, "deploy")) == 2
    comment = _shipped_comment(world)
    assert "Android: failed" in comment
    # the deploy stands and the run still cleaned up
    assert not world.slice_worktree_path("release-story-1000").exists()


def test_a_worktree_that_cannot_be_cleaned_up_is_reported_after_the_comment(world):
    _shippable(world)
    world.given_worktree_done_fails("story-1000-domain")

    result = run_flow(world, "1000")

    assert result.returncode == 26, result.stdout + result.stderr
    assert _shipped_comment(world)
    assert any("story-1000-domain" in body for body in _comments(world))


def test_a_missing_deploy_target_stops_before_any_side_effect(world):
    _shippable(world)

    result = run_flow(world, "1000", env_extra={"FIT_FLOW_QA_DEPLOY_HOST": ""})

    assert result.returncode == 2, result.stdout + result.stderr
    assert "FIT_FLOW_QA_DEPLOY_HOST" in result.stderr
    assert [call for call in world.calls() if call.get("tool") == "gh"] == []


def test_a_missing_production_target_is_only_required_when_shipping_there(world):
    _shippable(world)

    held = run_flow(world, "1000", env_extra={"FIT_FLOW_PROD_PUBLIC_ORIGIN": ""})
    assert held.returncode == 2, held.stdout + held.stderr
    assert "FIT_FLOW_PROD_PUBLIC_ORIGIN" in held.stderr

    result = run_flow(
        world,
        "1000",
        env_extra={"FIT_FLOW_PROD_PUBLIC_ORIGIN": "", "FIT_FLOW_SHIP_TO": "qa"},
    )
    assert result.returncode == 0, result.stdout + result.stderr
