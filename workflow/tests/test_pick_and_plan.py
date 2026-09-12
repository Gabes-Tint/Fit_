"""End-to-end tests for go.py: black-box, subprocess only. No unit tests of
any helper - every assertion is on go.py's exit code, its log, and the
resulting fake-world state.
"""

import subprocess

import pytest
from conftest import delegate_slice, mechanic_signals, run_flow


def _given_single_domain_slice(world, number: int, title: str) -> None:
    world.given_story(number, title=title, labels=["story"])
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
                "title": title,
                "brief": "Write the missing acceptance test.",
                "acceptance": ["The missing behavior is specified."],
                "test_kind": "vitest",
            }
        ],
    )


def test_picks_lowest_story_not_held_with_one_slice(world):
    world.given_story(130, title="Faster first paint", labels=["story"])
    world.given_comment(
        130,
        "Later comment with\nuseful evidence.",
        "reviewer-two",
        "2026-09-03T12:00:00Z",
        2,
    )
    world.given_comment(
        130,
        "First human constraint.",
        "author-one",
        "2026-09-01T12:00:00Z",
        1,
    )
    world.given_timeline_event(
        130,
        event="labeled",
        created_at="2026-09-02T12:00:00Z",
        actor={"login": "maintainer"},
        label={"name": "accessibility"},
    )
    world.given_timeline_event(
        130,
        event="cross-referenced",
        created_at="2026-09-04T12:00:00Z",
        actor={"login": "builder"},
        source={
            "issue": {
                "number": 999,
                "title": "Related implementation",
                "html_url": "https://example.test/pull/999",
                "pull_request": {"html_url": "https://example.test/pull/999"},
            }
        },
    )
    world.given_timeline_event(
        130,
        event="commented",
        created_at="2026-09-05T12:00:00Z",
        actor={"login": "duplicate"},
    )
    world.given_timeline_event(
        130,
        event="closed",
        created_at="2026-09-04T13:00:00Z",
        actor={"login": "closer"},
        html_url="https://example.test/issues/130#event-closed",
    )
    world.given_timeline_event(
        130,
        event="reopened",
        created_at="2026-09-04T14:00:00Z",
        actor={"login": "reopener"},
        html_url="https://example.test/issues/130#event-reopened",
    )
    world.given_timeline_event(
        130,
        event="committed",
        created_at="2026-09-04T15:00:00Z",
        actor={"login": "committer"},
        commit_id="abc123",
    )
    world.given_timeline_event(
        130,
        event="reviewed",
        submitted_at="2026-09-04T16:00:00Z",
        user={"login": "reviewer"},
        state="approved",
        body="Evidence checked.",
        html_url="https://example.test/reviews/1",
    )
    world.given_timeline_event(
        130,
        event="subscribed",
        created_at="2026-09-06T12:00:00Z",
        actor={"login": "noise"},
    )
    world.planner_answers_whose_call(
        130,
        owner="orchestrator",
        category="none",
        reason="ordinary maintainability work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        130,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Faster first paint",
                "brief": "Trim the log screen's first render.",
                "acceptance": ["The log screen paints under 200ms on a cold load."],
                "test_kind": "vitest",
            }
        ],
    )
    slug = "story-130-domain"
    world.mechanic_writes(
        slug,
        files={"src/lib/paint.spec.ts": "// failing spec\n"},
        test_files=["src/lib/paint.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/paint.spec.ts", ["fail", "pass"])
    world.planner_answers_delegate(130, [delegate_slice(130, "domain", mechanic_signals())])
    world.agent_implements(
        "story-130-domain",
        "mechanic",
        files={"src/lib/paint.ts": "export const paint = (ms: number) => ms;\n"},
        changed_files=["src/lib/paint.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    issue = world.issue(130)
    assert "in-progress" in issue["labels"]
    assert any("brief" in c.lower() or "trim the log" in c.lower() for c in issue["comments"])
    assert world.branch_exists_on_origin(slug)
    assert not world.planner_worktree_path(130).exists()
    assert "📥 Sync: fetched origin" in result.stdout
    assert '📋 Picked #130 "Faster first paint"' in result.stdout
    assert "🔀 Whose call? → 🧑‍💻 orchestrator's" in result.stdout
    assert "Spending flagged?" not in result.stdout
    assert "Slice 1:" in result.stdout
    assert "Trim the log screen's first render." in result.stdout
    assert "the behavior is not implemented yet" in result.stdout
    assert "🏁 Planned #130" in result.stdout
    assert "mechanics in parallel" not in result.stdout
    api_calls = [c["argv"][1] for c in world.calls() if c.get("argv", [None])[0] == "api"]
    assert api_calls == [
        "repos/Gabes-Tint/Fit_/issues/130/comments?per_page=100",
        "repos/Gabes-Tint/Fit_/issues/130/timeline?per_page=100",
    ]
    planner_prompts = [
        c["prompt"]
        for c in world.calls()
        if c.get("tool") == "aarmy" and c["argv"][0:2] == ["talk", "planner"]
    ]
    assert len(planner_prompts) == 3
    slicing_prompt = planner_prompts[1]
    normalized_slicing_prompt = " ".join(slicing_prompt.split())
    assert '"ui" means frontend/interface work in Svelte components and routes' in slicing_prompt
    assert '"domain" means every non-UI change' in slicing_prompt
    assert "server/backend code, persistence, migrations, and database changes" in slicing_prompt
    assert "Two is the maximum; never return a third slice." in normalized_slicing_prompt
    assert "wholly UI or wholly non-UI" in slicing_prompt
    for prompt in planner_prompts[:2]:
        first = prompt.index("2026-09-01T12:00:00Z | comment | author-one")
        label = prompt.index("2026-09-02T12:00:00Z | labeled | maintainer")
        later = prompt.index("2026-09-03T12:00:00Z | comment | reviewer-two")
        linked = prompt.index("2026-09-04T12:00:00Z | cross-referenced | builder")
        assert first < label < later < linked
        assert "Later comment with useful evidence." in prompt
        assert "pull request #999: Related implementation" in prompt
        assert "closed | closer | https://example.test/issues/130#event-closed" in prompt
        assert "reopened | reopener | https://example.test/issues/130#event-reopened" in prompt
        assert "committed | committer | abc123" in prompt
        assert "reviewed | reviewer | approved | Evidence checked." in prompt
        assert "duplicate" not in prompt
        assert "subscribed" not in prompt
        assert "Do not browse GitHub yourself." in prompt


def test_split_story_creates_two_children_with_pushed_failing_tests(world):
    world.given_story(140, title="Sync payload", labels=["story"])
    world.planner_answers_whose_call(
        140,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        140,
        spans_domain_and_ui=True,
        slices=[
            {
                "layer": "domain",
                "title": "Sync payload logic",
                "brief": "Add the merge function.",
                "acceptance": ["Merging two payloads keeps the newer field."],
                "test_kind": "vitest",
            },
            {
                "layer": "ui",
                "title": "Sync payload screen",
                "brief": "Show the merge conflict banner.",
                "acceptance": ["A conflict shows a banner at 360px."],
                "test_kind": "playwright",
            },
        ],
    )
    world.mechanic_writes(
        "story-1000-domain",
        files={"src/lib/merge.spec.ts": "// first attempt\n"},
        test_files=["src/lib/merge.spec.ts"],
        push=False,
        rendezvous="split-success",
    )
    world.mechanic_writes(
        "story-1000-domain",
        files={"src/lib/merge.spec.ts": "// corrected failing test\n"},
        test_files=["src/lib/merge.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/merge.spec.ts", ["fail", "pass"])
    world.mechanic_writes(
        "story-1001-ui",
        files={"src/routes/merge.e2e.ts": "// failing\n"},
        test_files=["src/routes/merge.e2e.ts"],
        rendezvous="split-success",
    )
    world.scripted_test_outcome("src/routes/merge.e2e.ts", ["fail", "pass"])
    world.planner_answers_delegate(
        140,
        [
            delegate_slice(140, "domain", mechanic_signals()),
            delegate_slice(140, "ui", mechanic_signals()),
        ],
    )
    world.agent_implements(
        "story-1000-domain",
        "mechanic",
        files={"src/lib/merge.ts": "export const merge = (a: number) => a;\n"},
        changed_files=["src/lib/merge.ts"],
        rendezvous="split-implement",
    )
    world.agent_implements(
        "story-1001-ui",
        "mechanic",
        files={"src/routes/merge-page.ts": "export const banner = true;\n"},
        changed_files=["src/routes/merge-page.ts"],
        rendezvous="split-implement",
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    domain_child = world.issue(1000)
    ui_child = world.issue(1001)
    assert set(domain_child["labels"]) >= {"story", "in-progress"}
    assert set(ui_child["labels"]) >= {"story", "in-progress"}
    assert "part of #140" in domain_child["body"].lower()
    assert "part of #140" in ui_child["body"].lower()
    assert world.branch_exists_on_origin("story-1000-domain")
    assert world.branch_exists_on_origin("story-1001-ui")
    story_comments = " ".join(world.issue(140)["comments"]).lower()
    assert "#1000" in story_comments
    assert "#1001" in story_comments
    assert "implemented" in story_comments
    calls = world.calls()
    prepared = [
        index
        for index, call in enumerate(calls)
        if call.get("tool") == "bun"
        and call.get("argv", [None, None])[0:2] == ["run", "worktree:new"]
    ]
    mechanic_started = [
        index
        for index, call in enumerate(calls)
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    finished = [
        index
        for index, call in enumerate(calls)
        if call.get("event") == "agent_finished" and call.get("role") == "mechanic"
    ]
    planned = next(
        index
        for index, call in enumerate(calls)
        if call.get("tool") == "gh"
        and call.get("argv", [None, None, None])[0:3] == ["issue", "comment", "140"]
        and "Planned:" in call["argv"][call["argv"].index("--body") + 1]
    )
    assert len(finished) == 5
    assert len(prepared) == 2
    assert max(prepared) < min(mechanic_started)
    assert finished[2] < planned < finished[3]
    assert "Starting 2 mechanics in parallel" in result.stdout
    assert "Mechanic barrier: all 2 slices settled" in result.stdout
    mechanic_teams = [
        call["argv"][call["argv"].index("--team") + 1]
        for call in calls
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    assert mechanic_teams.count("story-1000-domain") == 3
    assert mechanic_teams.count("story-1001-ui") == 2


@pytest.mark.parametrize("ui_fails", [False, True])
def test_parallel_mechanics_settle_before_reporting_ordered_failures(world, ui_fails):
    world.given_story(145, title="Two slice failure", labels=["story"])
    world.planner_answers_whose_call(
        145,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        145,
        spans_domain_and_ui=True,
        slices=[
            {
                "layer": "domain",
                "title": "Domain half",
                "brief": "Write the domain acceptance test.",
                "acceptance": ["The missing domain behavior is specified."],
                "test_kind": "vitest",
            },
            {
                "layer": "ui",
                "title": "UI half",
                "brief": "Write the UI acceptance test.",
                "acceptance": ["The missing UI behavior is specified."],
                "test_kind": "playwright",
            },
        ],
    )
    world.mechanic_fails("story-1000-domain", "domain mechanic failed", rendezvous="split-failures")
    if ui_fails:
        world.mechanic_fails("story-1001-ui", "ui mechanic failed", rendezvous="split-failures")
    else:
        world.mechanic_writes(
            "story-1001-ui",
            files={"src/routes/two-slice.e2e.ts": "// failing\n"},
            test_files=["src/routes/two-slice.e2e.ts"],
            rendezvous="split-failures",
        )
        world.scripted_test_outcome("src/routes/two-slice.e2e.ts", "fail")

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    assert "domain mechanic failed" in result.stdout
    assert "Mechanic barrier: all 2 slices settled" in result.stdout
    assert "Mechanic #1000 (domain): AGENT_FAILED" in result.stdout
    assert not any("Planned:" in comment for comment in world.issue(145)["comments"])
    assert any("Stopped: AGENT_FAILED" in comment for comment in world.issue(145)["comments"])
    assert not any("Stopped: AGENT_FAILED" in comment for comment in world.issue(1000)["comments"])
    finished = [
        call
        for call in world.calls()
        if call.get("event") == "agent_finished" and call.get("role") == "mechanic"
    ]
    assert len(finished) == 2
    mechanic_calls = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    assert len(mechanic_calls) == 2
    if ui_fails:
        domain_failure = result.stdout.index("Mechanic #1000 (domain): AGENT_FAILED")
        ui_failure = result.stdout.index("Mechanic #1001 (ui): AGENT_FAILED")
        assert domain_failure < ui_failure
        assert "domain mechanic failed" in result.stderr
        assert {call["ok"] for call in finished} == {False}
    else:
        assert any("Ready for block 2" in comment for comment in world.issue(1001)["comments"])
        assert {call["ok"] for call in finished} == {False, True}


def test_agent_failure_reports_preserved_dirty_worktree_on_parent_story(world):
    _given_single_domain_slice(world, 146, "Dirty failed agent")
    world.mechanic_fails(
        "story-146-domain",
        "provider unavailable",
        files={"src/lib/domain/partial.spec.ts": "// partial agent work\n"},
    )

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    comments = "\n".join(world.issue(146)["comments"])
    assert "dirty (preserved for audit)" in comments
    assert "?? src/lib/domain/partial.spec.ts" in comments
    assert world.slice_worktree_path("story-146-domain").exists()


def test_explicit_issue_number_wins_over_lowest(world):
    world.given_story(10, title="Lower story", labels=["story"])
    world.given_story(20, title="Chosen story", labels=["story"])
    world.planner_answers_whose_call(
        20,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        20,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Chosen story",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )
    world.mechanic_writes(
        "story-20-domain",
        files={"src/lib/x.spec.ts": "// failing\n"},
        test_files=["src/lib/x.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/x.spec.ts", ["fail", "pass"])
    world.planner_answers_delegate(20, [delegate_slice(20, "domain", mechanic_signals())])
    world.agent_implements(
        "story-20-domain",
        "mechanic",
        files={"src/lib/x.ts": "export const x = 1;\n"},
        changed_files=["src/lib/x.ts"],
    )

    result = run_flow(world, "20")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "in-progress" in world.issue(20)["labels"]
    assert "in-progress" not in world.issue(10)["labels"]


def test_nothing_to_pick_when_every_story_is_held(world):
    world.given_story(30, title="Held story", labels=["story", "paused"])

    result = run_flow(world)

    assert result.returncode == 10, result.stdout + result.stderr
    assert world.issue(30)["labels"] == ["story", "paused"]
    assert all(c.get("argv", [None])[0:2] != ["issue", "comment"] for c in world.calls())


def test_explicit_issue_number_that_does_not_exist_cannot_be_picked(world):
    result = run_flow(world, "999")

    assert result.returncode == 20, result.stdout + result.stderr
    assert all(c.get("argv", [None])[0:2] != ["issue", "comment"] for c in world.calls())


@pytest.mark.parametrize(
    "state,labels",
    [
        ("CLOSED", ["story"]),
        ("OPEN", ["story", "in-progress"]),
        ("OPEN", []),
    ],
)
def test_explicit_issue_held_closed_or_not_a_story_cannot_be_picked(world, state, labels):
    world.given_story(40, title="Bad pick", labels=labels, state=state)

    result = run_flow(world, "40")

    assert result.returncode == 20, result.stdout + result.stderr


def test_gabriel_owning_the_call_hands_off_without_a_worktree_or_mechanic(world):
    world.given_story(50, title="Spend real money", labels=["story"])
    world.planner_answers_whose_call(
        50,
        owner="gabriel",
        category="spend",
        reason="this needs a paid API key",
        question="Should we buy the API plan?",
        options=["Buy the plan"],
        recommendation="Buy the plan; it's cheap",
    )

    result = run_flow(world)

    assert result.returncode == 11, result.stdout + result.stderr
    issue = world.issue(50)
    assert "needs-gabriel" in issue["labels"]
    assert "gabepsilva" in issue["assignees"]
    comment = " ".join(issue["comments"]).lower()
    assert "buy the plan" in comment
    assert "do nothing" in comment
    assert not world.slice_worktree_path("story-50-domain").exists()
    assert not any(
        c.get("tool") == "aarmy" and c["argv"][0:2] == ["talk", "mechanic"] for c in world.calls()
    )
    assert "Question:" in result.stdout
    assert "Should we buy the API plan?" in result.stdout
    assert "Options:" in result.stdout
    assert "Buy the plan" in result.stdout


def test_planner_turn_failing_stops_the_flow_with_a_comment(world):
    world.given_story(70, title="Bad planner", labels=["story"])
    world.planner_fails(70, message="planner crashed")

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    issue = world.issue(70)
    assert any("stopped" in c.lower() for c in issue["comments"])


@pytest.mark.parametrize(
    "spans_domain_and_ui,slices",
    [
        (
            False,
            [
                {
                    "layer": "domain",
                    "title": "a",
                    "brief": "b",
                    "acceptance": ["a"],
                    "test_kind": "vitest",
                },
                {
                    "layer": "ui",
                    "title": "c",
                    "brief": "d",
                    "acceptance": ["a"],
                    "test_kind": "playwright",
                },
            ],
        ),
        (
            True,
            [
                {
                    "layer": "domain",
                    "title": "a",
                    "brief": "b",
                    "acceptance": ["a"],
                    "test_kind": "vitest",
                }
            ],
        ),
        (
            True,
            [
                {
                    "layer": "ui",
                    "title": "a",
                    "brief": "b",
                    "acceptance": ["a"],
                    "test_kind": "playwright",
                },
                {
                    "layer": "domain",
                    "title": "c",
                    "brief": "d",
                    "acceptance": ["a"],
                    "test_kind": "vitest",
                },
            ],
        ),
        (
            True,
            [
                {
                    "layer": "domain",
                    "title": "a",
                    "brief": "b",
                    "acceptance": ["a"],
                    "test_kind": "vitest",
                },
                {
                    "layer": "ui",
                    "title": "c",
                    "brief": "d",
                    "acceptance": ["a"],
                    "test_kind": "playwright",
                },
                {
                    "layer": "domain",
                    "title": "third",
                    "brief": "never allowed",
                    "acceptance": ["a"],
                    "test_kind": "vitest",
                },
            ],
        ),
    ],
)
def test_planner_breaking_the_slice_contract_is_a_hard_stop(world, spans_domain_and_ui, slices):
    world.given_story(80, title="Contract break", labels=["story"])
    world.planner_answers_whose_call(
        80,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(80, spans_domain_and_ui=spans_domain_and_ui, slices=slices)

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(80)["comments"])


def test_mechanic_not_pushing_stops_the_flow(world):
    world.given_story(90, title="Forgot to push", labels=["story"])
    world.planner_answers_whose_call(
        90,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        90,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Forgot to push",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )
    world.mechanic_changes_without_pushing(
        "story-90-domain",
        files={"src/lib/y.spec.ts": "// failing\n"},
        test_files=["src/lib/y.spec.ts"],
    )
    world.mechanic_replies("story-90-domain", ["src/lib/y.spec.ts"])
    world.mechanic_replies("story-90-domain", ["src/lib/y.spec.ts"])

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert not world.branch_exists_on_origin("story-90-domain")
    assert any("stopped" in c.lower() for c in world.issue(90)["comments"])
    assert "exhausted 3 attempts" in result.stdout
    mechanic_calls = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    assert len(mechanic_calls) == 3


def test_mechanic_corrects_repairable_failure_on_first_retry(world):
    _given_single_domain_slice(world, 91, "Correct after rejection")
    slug = "story-91-domain"
    test_file = "src/lib/retry.spec.ts"
    world.mechanic_changes_without_pushing(
        slug, files={test_file: "// attempt one\n"}, test_files=[test_file]
    )
    world.mechanic_writes(
        slug, files={test_file: "// corrected attempt two\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(91, [delegate_slice(91, "domain", mechanic_signals())])
    world.agent_implements(
        "story-91-domain",
        "mechanic",
        files={"src/lib/retry.ts": "export const retry = (n: number) => n;\n"},
        changed_files=["src/lib/retry.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    mechanic_calls = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    assert len(mechanic_calls) == 3
    assert {call["argv"][call["argv"].index("--team") + 1] for call in mechanic_calls} == {slug}
    retry_prompt = mechanic_calls[1]["prompt"]
    normalized_retry_prompt = " ".join(retry_prompt.split())
    assert "TESTS_NOT_PUSHED: local HEAD not pushed" in retry_prompt
    assert "Fix only the acceptance tests" in retry_prompt
    assert "Do not implement product behavior" in normalized_retry_prompt
    assert "passed validation on attempt 2" in result.stdout


def test_mechanic_can_succeed_only_on_second_retry(world):
    _given_single_domain_slice(world, 92, "Correct on final attempt")
    slug = "story-92-domain"
    test_file = "src/lib/final-retry.spec.ts"
    world.mechanic_changes_without_pushing(
        slug, files={test_file: "// attempt one\n"}, test_files=[test_file]
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// attempt two\n"},
        test_files=[test_file],
        push=False,
    )
    world.mechanic_writes(
        slug, files={test_file: "// corrected attempt three\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(92, [delegate_slice(92, "domain", mechanic_signals())])
    world.agent_implements(
        "story-92-domain",
        "mechanic",
        files={"src/lib/final-retry.ts": "export const done = true;\n"},
        changed_files=["src/lib/final-retry.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    mechanic_calls = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    assert len(mechanic_calls) == 4
    assert "passed validation on attempt 3" in result.stdout


def test_test_runner_tool_failure_does_not_retry_mechanic(world):
    _given_single_domain_slice(world, 93, "Runner unavailable")
    slug = "story-93-domain"
    test_file = "src/lib/tool-error.spec.ts"
    world.mechanic_writes(slug, files={test_file: "// test\n"}, test_files=[test_file])
    world.scripted_test_outcome(test_file, "tool_error")

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    mechanic_calls = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    assert len(mechanic_calls) == 1
    assert "retrying after attempt" not in result.stdout
    assert "produced no parsable JSON report" in result.stdout


def test_mechanic_changing_a_non_test_file_stops_the_flow(world):
    world.given_story(95, title="Touched real code", labels=["story"])
    world.planner_answers_whose_call(
        95,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        95,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Touched real code",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )
    world.mechanic_writes(
        "story-95-domain",
        files={"src/lib/z.spec.ts": "// failing\n", "src/lib/z.ts": "export const z = 1;\n"},
        test_files=["src/lib/z.spec.ts"],
    )
    world.mechanic_replies("story-95-domain", ["src/lib/z.spec.ts"])
    world.mechanic_replies("story-95-domain", ["src/lib/z.spec.ts"])

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(95)["comments"])


def test_slice_rejects_changed_test_for_the_other_runner(world):
    _given_single_domain_slice(world, 96, "Wrong runner test")
    slug = "story-96-domain"
    test_file = "src/routes/wrong-runner.e2e.ts"
    world.mechanic_writes(slug, files={test_file: "// wrong kind\n"}, test_files=[test_file])
    world.mechanic_replies(slug, [test_file])
    world.mechanic_replies(slug, [test_file])

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert "vitest slice changed wrong-kind test" in result.stdout
    assert "exhausted 3 attempts" in result.stdout


def test_tests_that_already_pass_stop_the_flow(world):
    world.given_story(100, title="Tests already pass", labels=["story"])
    world.planner_answers_whose_call(
        100,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        100,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Tests already pass",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )
    world.mechanic_writes(
        "story-100-domain",
        files={"src/lib/w.spec.ts": "// passes\n"},
        test_files=["src/lib/w.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/w.spec.ts", "pass")
    world.mechanic_replies("story-100-domain", ["src/lib/w.spec.ts"])
    world.mechanic_replies("story-100-domain", ["src/lib/w.spec.ts"])

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(100)["comments"])


def test_vitest_import_failure_does_not_count_as_failing_acceptance_test(world):
    _given_single_domain_slice(world, 101, "Broken product import")
    slug = "story-101-domain"
    test_file = "src/lib/domain/broken-import.spec.ts"
    test_source = (
        "import { expect, it } from 'vitest';\n"
        "import { missing } from './missing';\n"
        "it('uses product', () => expect(missing()).toBe(true));\n"
    )
    world.mechanic_writes(slug, files={test_file: test_source}, test_files=[test_file])
    world.scripted_test_outcome(test_file, "import_error")
    world.mechanic_replies(slug, [test_file])
    world.mechanic_replies(slug, [test_file])

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert "failed before running any assertion" in result.stdout
    assert "exhausted 3 attempts" in result.stdout


def test_playwright_file_that_never_ran_stops_the_flow(world):
    world.given_story(105, title="Spec never ran", labels=["story"])
    world.planner_answers_whose_call(
        105,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        105,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "ui",
                "title": "Spec never ran",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "playwright",
            }
        ],
    )
    world.mechanic_writes(
        "story-105-ui",
        files={"src/routes/gone.e2e.ts": "// failing\n"},
        test_files=["src/routes/gone.e2e.ts"],
    )
    world.scripted_test_outcome("src/routes/gone.e2e.ts", "not_found")
    world.mechanic_replies("story-105-ui", ["src/routes/gone.e2e.ts"])
    world.mechanic_replies("story-105-ui", ["src/routes/gone.e2e.ts"])

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(105)["comments"])


def test_slice_worktree_already_existing_stops_the_flow(world):
    world.given_story(110, title="Duplicate worktree", labels=["story"])
    world.planner_answers_whose_call(
        110,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        110,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Duplicate worktree",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )
    subprocess.run(
        [
            "git",
            "worktree",
            "add",
            "-b",
            "story-110-domain",
            str(world.slice_worktree_path("story-110-domain")),
            "origin/main",
        ],
        cwd=world.repo,
        check=True,
        capture_output=True,
    )

    result = run_flow(world)

    assert result.returncode == 25, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(110)["comments"])


def test_planner_worktree_is_removed_even_when_the_run_fails(world):
    world.given_story(120, title="Cleanup check", labels=["story"])
    world.planner_fails(120, message="boom")

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    assert not world.planner_worktree_path(120).exists()


def test_leftover_planner_worktree_from_a_dead_run_does_not_poison_the_next_one(world):
    world.given_story(130, title="Leftover worktree", labels=["story"])
    leftover = world.planner_worktree_path(130)
    leftover.mkdir(parents=True)
    (leftover / "junk").write_text("stale from a killed run\n")
    world.planner_answers_whose_call(
        130,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        130,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "domain",
                "title": "Leftover worktree",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )
    world.mechanic_writes(
        "story-130-domain",
        files={"src/lib/leftover.spec.ts": "// failing\n"},
        test_files=["src/lib/leftover.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/leftover.spec.ts", ["fail", "pass"])
    world.planner_answers_delegate(130, [delegate_slice(130, "domain", mechanic_signals())])
    world.agent_implements(
        "story-130-domain",
        "mechanic",
        files={"src/lib/leftover.ts": "export const leftover = true;\n"},
        changed_files=["src/lib/leftover.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert not world.planner_worktree_path(130).exists()


def test_a_gh_failure_mid_run_stops_the_flow_as_a_tool_failure(world):
    world.given_story(150, title="gh goes down", labels=["story"])
    world.planner_answers_whose_call(
        150,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.gh_fails_on("--add-label in-progress")

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "❌ TOOL_FAILED (exit 26)" in result.stdout
    assert any("stopped" in c.lower() for c in world.issue(150)["comments"])


# --- block 1 validates the failing-test branch itself (issues #377, #380) --------


def test_lint_broken_acceptance_tests_are_rejected_in_block_1_and_repaired(world):
    _given_single_domain_slice(world, 210, "Lint-clean acceptance tests")
    slug = "story-210-domain"
    test_file = "src/lib/wild-assert.spec.ts"
    # attempt 1: the tests fail their own change-scoped lint (for a missing
    # module, a bound `any` import is flagged, never suppressed)
    world.mechanic_writes(
        slug,
        files={test_file: "const mod: any = 1;\nexpect(mod.missing()).toBe(true);\n"},
        test_files=[test_file],
    )
    world.given_gate_outcomes(
        **{
            "lint:changed": [
                "fail",
                "pass",
            ]
        }
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// corrective attempt: unknown-typed dynamic import\n"},
        test_files=[test_file],
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(210, [delegate_slice(210, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/wild.ts": "export const wild = (n: number) => n;\n"},
        changed_files=["src/lib/wild.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "TESTS_INVALID: lint:changed failed on the acceptance tests" in result.stdout
    # the diagnostic carries both streams: eslint writes the error body to
    # stderr and its counting summary to stdout, and neither may be dropped
    assert "no-unsafe-call" in result.stdout
    assert "1 problem found in 1 file" in result.stdout
    assert "🔁 Mechanic #210 retrying after attempt 1" in result.stdout
    assert "🧪 Gates: lint:changed ✔" in result.stdout
    assert "❌ BLOCKED" not in result.stdout
    assert world.branch_exists_on_origin(slug)


def test_acceptance_tests_that_always_fail_lint_exhaust_the_mechanic(world):
    _given_single_domain_slice(world, 211, "Tests that never lint clean")
    slug = "story-211-domain"
    test_file = "src/lib/dirty.spec.ts"
    for index in range(3):
        world.mechanic_writes(
            slug,
            files={test_file: f"const mod: any = {index};\nexpect(mod.missing()).toBe(true);\n"},
            test_files=[test_file],
        )
    world.given_gate_outcomes(**{"lint:changed": ["fail", "fail", "fail"]})

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert "exhausted 3 attempts" in result.stdout
    assert "Stopped: TESTS_INVALID" in "\n".join(world.issue(211)["comments"])
    # block 3 never started: the flow stopped in block 1, after exactly the
    # mechanic's three attempts and before any signal planning turn
    signal_turns = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call["argv"][call["argv"].index("--schema") + 1].endswith("delegate.json")
    ]
    assert signal_turns == []
    assert len(_mechanic_talks(world)) == 3


def _mechanic_talks(world) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy" and call["argv"][0:2] == ["talk", "mechanic"]
    ]


def test_lint_suppression_directives_in_acceptance_tests_are_rejected(world):
    _given_single_domain_slice(world, 212, "No suppression in acceptance tests")
    slug = "story-212-domain"
    test_file = "src/lib/suppressed.spec.ts"
    # the #377 shape: a directive that only holds while the module is missing
    world.mechanic_writes(
        slug,
        files={
            test_file: (
                "// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment\n"
                "const mod: any = 1;\nexpect(mod.missing()).toBe(true);\n"
            )
        },
        test_files=[test_file],
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// corrected, suppression-free\n"},
        test_files=[test_file],
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(212, [delegate_slice(212, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/suppressed.ts": "export const suppressed = true;\n"},
        changed_files=["src/lib/suppressed.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "TESTS_INVALID: suppressed.spec.ts contains the lint suppression directive" in result.stdout
    )
    assert "eslint-disable" in result.stdout
    assert "Stopped: TESTS_INVALID" not in "\n".join(world.issue(212)["comments"])


def test_a_component_spec_that_imports_in_the_browser_is_rejected(world):
    world.given_story(213, title="Component in browser context", labels=["story"])
    world.planner_answers_whose_call(
        213,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        213,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "ui",
                "title": "Component in browser context",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "playwright",
            }
        ],
    )
    slug = "story-213-ui"
    rejected = "src/routes/status-badge-import.e2e.ts"
    corrected = "src/routes/status-badge-harness.e2e.ts"
    world.mechanic_writes(
        slug,
        files={
            rejected: (
                "test('importable', async ({ page }) => {\n"
                "  await page.goto('/');\n"
                "  const canImport = await page.evaluate(async () => {\n"
                "    return Boolean(await import('$lib/components/StatusBadge.svelte'));\n"
                "  });\n"
                "  expect(canImport).toBe(true);\n"
                "});\n"
            )
        },
        test_files=[rejected],
    )
    world.mechanic_writes(
        slug,
        files={
            corrected: (
                "test('renders badge', async ({ page }) => {\n"
                "  await page.goto(\n"
                "    '/dev/component-harness?component=components/StatusBadge'\n"
                "  );\n"
                "  await expect(page.getByText('harness: component not found')).toBeVisible();\n"
                "});\n"
            )
        },
        test_files=[corrected],
        delete=[rejected],
    )
    world.scripted_test_outcome(corrected, ["fail", "pass"])
    world.planner_answers_delegate(213, [delegate_slice(213, "ui", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/components/StatusBadge.svelte": "<span>ok</span>\n"},
        changed_files=["src/lib/components/StatusBadge.svelte"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "TESTS_INVALID: status-badge-import.e2e.ts imports the product with page.evaluate"
        in result.stdout
    )
    assert "/dev/component-harness" in result.stdout
    # the accepted harness-based failing coverage later passed after
    # implementation: the flow reached IMPLEMENTED without touching the test
    assert "🏁 Implemented #213" in result.stdout


def test_a_ui_route_fixture_is_rejected_like_a_production_file(world):
    world.given_story(214, title="No invented routes", labels=["story"])
    world.planner_answers_whose_call(
        214,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        214,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "ui",
                "title": "No invented routes",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "playwright",
            }
        ],
    )
    slug = "story-214-ui"
    test_file = "src/routes/status-badge.e2e.ts"
    fixture = "src/routes/status-badge-harness-fixture/+page.svelte"
    world.mechanic_writes(
        slug,
        files={
            fixture: "<span>fixture</span>\n",
            test_file: (
                "test('renders badge', async ({ page }) => {\n"
                "  await page.goto('/my-bad-fixture');\n"
                "  await expect(page.getByText('fixture')).toBeVisible();\n"
                "});\n"
            ),
        },
        test_files=[fixture, test_file],
    )
    world.mechanic_writes(
        slug,
        files={
            test_file: (
                "test('renders badge', async ({ page }) => {\n"
                "  await page.goto(\n"
                "    '/dev/component-harness?component=components/StatusBadge'\n"
                "  );\n"
                "  await expect(page.getByText('ok')).toBeVisible();\n"
                "});\n"
            )
        },
        test_files=[test_file],
        delete=["src/routes/status-badge-harness-fixture/+page.svelte"],
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(214, [delegate_slice(214, "ui", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/components/StatusBadge.svelte": "<span>ok</span>\n"},
        changed_files=["src/lib/components/StatusBadge.svelte"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "non-test file changed on story-214-ui: "
        "src/routes/status-badge-harness-fixture/+page.svelte"
    ) in result.stdout
    assert "TESTS_NOT_PUSHED: non-test file changed" in result.stdout
    assert "🏁 Implemented #214" in result.stdout


def test_a_committed_non_test_file_across_a_retry_is_caught_by_the_branch_delta(world):
    _given_single_domain_slice(world, 215, "Branch delta over a retry")
    slug = "story-215-domain"
    test_file = "src/lib/delta.spec.ts"
    world.mechanic_writes(
        slug,
        files={
            test_file: "// failing\n",
            "quality/suppression-baseline.json": '{"maxUnjustified": 8}\n',
        },
        test_files=[test_file],
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// clean retry: the policy file is gone\n"},
        test_files=[test_file],
        delete=["quality/suppression-baseline.json"],
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(215, [delegate_slice(215, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/delta.ts": "export const delta = true;\n"},
        changed_files=["src/lib/delta.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "quality/suppression-baseline.json not found on branch" not in result.stdout
    assert "TESTS_NOT_PUSHED: " in result.stdout
    assert "non-test file changed on story-215-domain: quality/suppression-baseline.json" in (
        result.stdout
    )
