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
    # held in block 1, released again by block 5's cleanup
    assert ["--add-label", "in-progress"] in world.label_edits(130)
    assert ["--remove-label", "in-progress"] in world.label_edits(130)
    assert any("brief" in c.lower() or "trim the log" in c.lower() for c in issue["comments"])
    # pushed in block 1, and deleted on origin by block 5 once it landed
    assert slug in world.ship_record(130)["cleanup"]["remote_deleted"]
    assert not world.branch_exists_on_origin(slug)
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
    assert "wholly UI, wholly non-UI, or wholly the driver" in slicing_prompt
    assert '"workflow" means a change to this development flow\'s own driver' in slicing_prompt
    assert "A workflow story is always exactly one slice" in slicing_prompt
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
    # both were pushed in block 1; block 5 deleted them on origin once they
    # landed, and the record says at which commit
    deleted = world.ship_record(140)["cleanup"]["remote_deleted"]
    assert "story-1000-domain" in deleted and "story-1001-ui" in deleted
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
        # block 1's two slice worktrees; block 5 creates a release one later
        and call["argv"][2].startswith("story-")
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
    assert ["--add-label", "in-progress"] in world.label_edits(20)
    assert world.label_edits(10) == []


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

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert not world.branch_exists_on_origin("story-90-domain")
    assert any("stopped" in c.lower() for c in world.issue(90)["comments"])
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    mechanic_calls = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
    ]
    assert len(mechanic_calls) == 2


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


def test_a_second_different_diagnostic_keeps_the_mechanic_going_to_its_last_attempt(world):
    """Only an identical rejection ends the budget early. Attempt one
    forgets to push and attempt two leaves the tree dirty - two different
    failures, so the third attempt is still the mechanic's to take, and it
    is the one that gets it right."""
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
        commit=False,
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
    assert "🔁 Mechanic #92 retrying after attempt 1 — TESTS_NOT_PUSHED: local HEAD" in (
        result.stdout
    )
    assert "🔁 Mechanic #92 retrying after attempt 2 — TESTS_NOT_PUSHED: tree not clean" in (
        result.stdout
    )
    assert "stopped early" not in result.stdout
    assert "passed validation on attempt 3" in result.stdout


def test_the_same_mechanic_diagnostic_twice_stops_before_the_last_attempt(world):
    """#406 spent three mechanic turns and ten minutes on one diagnostic
    the driver's own test-file rule was wrong about: no reply could have
    fixed it, and the attempts after the first repeat bought nothing. An
    identical rejection now ends block 1's loop where it stands, and the
    comment on the story says how many attempts were left unspent."""
    _given_single_domain_slice(world, 97, "The same rejection twice")
    slug = "story-97-domain"
    test_file = "src/lib/same-again.spec.ts"
    world.mechanic_changes_without_pushing(
        slug, files={test_file: "// attempt one\n"}, test_files=[test_file]
    )
    world.mechanic_replies(slug, [test_file])

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert (
        "🛑 Mechanic #97 stopped early: attempt 2 failed exactly as attempt 1 — "
        "TESTS_NOT_PUSHED: local HEAD not pushed on story-97-domain"
    ) in result.stdout
    assert "retrying after attempt 2" not in result.stdout
    assert len(_mechanic_talks(world)) == 2
    stopped = "\n".join(world.issue(97)["comments"])
    assert "1 of 3 attempts went unspent" in stopped


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

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert "vitest slice changed wrong-kind test" in result.stdout
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout


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

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert "failed before running any assertion" in result.stdout
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout


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
    # the repaired tests were pushed, and shipped: block 5 deleted the branch
    assert slug in world.ship_record(210)["cleanup"]["remote_deleted"]


def test_acceptance_tests_that_always_fail_lint_the_same_way_stop_the_mechanic_early(world):
    _given_single_domain_slice(world, 211, "Tests that never lint clean")
    slug = "story-211-domain"
    test_file = "src/lib/dirty.spec.ts"
    for index in range(2):
        world.mechanic_writes(
            slug,
            files={test_file: f"const mod: any = {index};\nexpect(mod.missing()).toBe(true);\n"},
            test_files=[test_file],
        )
    world.given_gate_outcomes(**{"lint:changed": ["fail", "fail"]})

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "Stopped: TESTS_INVALID" in "\n".join(world.issue(211)["comments"])
    # block 3 never started: the flow stopped in block 1, after the two
    # attempts the repeated diagnostic was worth and before any signal turn
    signal_turns = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call["argv"][call["argv"].index("--schema") + 1].endswith("delegate.json")
    ]
    assert signal_turns == []
    assert len(_mechanic_talks(world)) == 2


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


# --- block 1 accepts only tests that can pass (issue #399) -----------------------


def test_an_acceptance_test_that_throws_is_rejected_in_block_1_and_repaired(world):
    _given_single_domain_slice(world, 216, "Tests that fail for the right reason")
    slug = "story-216-domain"
    test_file = "src/lib/thrower.spec.ts"
    # attempt 1 calls a helper the wrong way, so the test throws instead of
    # asserting and no implementation could ever make it pass
    world.mechanic_writes(
        slug,
        files={test_file: "// the helper is called with the wrong argument\n"},
        test_files=[test_file],
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// corrective attempt: a real expectation\n"},
        test_files=[test_file],
    )
    world.scripted_test_outcome(test_file, ["fail_defect", "fail", "pass"])
    world.planner_answers_delegate(216, [delegate_slice(216, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/thrower.ts": "export const thrower = () => 42;\n"},
        changed_files=["src/lib/thrower.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "TESTS_INVALID: this test fails because it is broken" in result.stdout
    # the diagnostic quotes the file, the test title and the runner's message
    assert "src/lib/thrower.spec.ts" in result.stdout
    assert "the behavior this slice asks for" in result.stdout
    assert "TypeError: locator.boundingBox is not a function" in result.stdout
    assert "Mechanic #216 retrying after attempt 1" in result.stdout
    assert "Implemented #216" in result.stdout


def test_acceptance_tests_that_always_throw_the_same_way_stop_the_mechanic_early(world):
    _given_single_domain_slice(world, 217, "Tests that never stop throwing")
    slug = "story-217-domain"
    test_file = "src/lib/always-throws.spec.ts"
    for index in range(2):
        world.mechanic_writes(
            slug,
            files={test_file: "// attempt " + str(index) + ": still throwing\n"},
            test_files=[test_file],
        )
    world.scripted_test_outcome(test_file, "fail_defect")

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "Stopped: TESTS_INVALID" in "\n".join(world.issue(217)["comments"])


def test_a_type_error_outside_the_acceptance_tests_is_rejected_in_block_1_and_repaired(world):
    """The type lane sees the whole project, and only the acceptance files
    are this branch's to be wrong in. An error in a shared fixture is the
    mechanic's to fix now, whatever the story adds."""
    _given_single_domain_slice(world, 218, "Type-correct acceptance tests")
    slug = "story-218-domain"
    test_file = "src/lib/typed.spec.ts"
    fixture = "tests/support/locators.ts"
    world.mechanic_writes(
        slug,
        files={test_file: "// passes a number where a Locator is expected\n"},
        test_files=[test_file],
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// corrective attempt: the helper's real signature\n"},
        test_files=[test_file],
    )
    world.given_gate_outcomes(check=["fail", "pass"])
    world.given_check_fails_on(fixture)
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(218, [delegate_slice(218, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/typed.ts": "export const typed = true;\n"},
        changed_files=["src/lib/typed.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "TESTS_INVALID: check found type errors in the acceptance tests" in result.stdout
    assert "not assignable to parameter of type 'Locator'" in result.stdout
    assert fixture + ":12:30" in result.stdout
    assert "these errors are outside the acceptance tests" in result.stdout
    assert "Gates: check" in result.stdout
    assert "lint ✔ · types ✔" in result.stdout
    assert "Implemented #218" in result.stdout


def test_acceptance_tests_that_never_type_check_the_same_way_stop_the_mechanic_early(world):
    _given_single_domain_slice(world, 219, "Tests that never type check")
    slug = "story-219-domain"
    test_file = "src/lib/never-typed.spec.ts"
    for index in range(2):
        world.mechanic_writes(
            slug,
            files={test_file: "// attempt " + str(index) + ": still mistyped\n"},
            test_files=[test_file],
        )
    world.given_gate_outcomes(check=["fail", "fail"])
    # TS2322 is not one of the missing-API codes: no implementation makes a
    # string assignable to a number, so it stays the mechanic's to fix
    world.given_type_errors_in(
        [test_file], ["TS2322"], "Type 'string' is not assignable to 'number'"
    )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "the implementation will not make these go away" in result.stdout
    assert "Stopped: TESTS_INVALID" in "\n".join(world.issue(219)["comments"])


# --- a story that introduces a new API (issue #422, children #423 and #424) ----


def test_type_errors_inside_the_acceptance_tests_are_accepted_before_the_api_exists(world):
    """#423's tests called `toggleSet(exerciseIndex, setIndex)` against a
    one-argument method, because that is what the brief asks the
    implementation to build. The type lane said so, three times, and the
    only corrections available were the suppressions block 1 forbids."""
    _given_single_domain_slice(world, 230, "Per-exercise store actions")
    slug = "story-230-domain"
    test_file = "src/lib/tend.svelte.spec.ts"
    world.mechanic_writes(
        slug,
        files={test_file: "// calls toggleSet(1, 0), which does not exist yet\n"},
        test_files=[test_file],
    )
    world.given_gate_outcomes(check="fail")
    world.given_type_errors_in(
        [test_file, test_file],
        ["TS2554", "TS2339"],
        "Expected 1 arguments, but got 2",
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(230, [delegate_slice(230, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/tend.svelte.ts": "export const toggleSet = (e: number) => e;\n"},
        changed_files=["src/lib/tend.svelte.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "🧪 Gates: check — 2 type errors inside the acceptance tests, "
        "expected before the implementation exists ✔" in result.stdout
    )
    assert "TESTS_INVALID" not in result.stdout
    assert "retrying after attempt 1" not in result.stdout
    assert "Implemented #230" in result.stdout
    assert world.run_record(230)["slices"]["domain"]["tests_type_debt"] == {test_file: 2}


def test_type_aware_lint_errors_inside_the_acceptance_tests_are_accepted_before_the_api_exists(
    world,
):
    """#424's spec produced 186 `@typescript-eslint/no-unsafe-*` errors
    from one import that does not resolve yet. Every one of them goes away
    when the implementation adds the export."""
    _given_single_domain_slice(world, 231, "Live workout screen")
    slug = "story-231-domain"
    test_file = "src/lib/live.spec.ts"
    world.mechanic_writes(
        slug,
        files={test_file: "// asserts against an export that does not exist yet\n"},
        test_files=[test_file],
    )
    world.given_gate_outcomes(**{"lint:changed": "fail"})
    world.given_lint_errors_in(
        [test_file, test_file],
        ["@typescript-eslint/no-unsafe-call", "@typescript-eslint/no-unsafe-member-access"],
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(231, [delegate_slice(231, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/live.ts": "export const live = true;\n"},
        changed_files=["src/lib/live.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "🧪 Gates: lint:changed — 2 lint errors inside the acceptance tests, "
        "expected before the implementation exists ✔" in result.stdout
    )
    assert "TESTS_INVALID" not in result.stdout
    assert "Implemented #231" in result.stdout


def test_a_syntax_error_is_still_rejected_however_the_type_lane_was_answered(world):
    """Accepting the type lane's account of a missing API changes nothing
    about the runtime verdict: the tests must still fail on an expectation
    the implementation would satisfy, and a file that throws never can."""
    _given_single_domain_slice(world, 235, "Missing API, broken syntax")
    slug = "story-235-domain"
    test_file = "src/lib/broken.spec.ts"
    for index in range(2):
        world.mechanic_writes(
            slug,
            files={test_file: f"// attempt {index}\n"},
            test_files=[test_file],
        )
    world.given_gate_outcomes(check="fail")
    world.given_type_errors_in([test_file], ["TS2339"])
    world.scripted_test_outcome(
        test_file, "fail_defect", message="SyntaxError: Unexpected token ')'"
    )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "expected before the implementation exists ✔" in result.stdout
    assert "this test fails because it is broken, not because the feature is missing" in (
        result.stdout
    )
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout


def test_a_type_error_in_a_fixture_outside_the_acceptance_tests_is_still_rejected(world):
    """The tolerance is confined to the acceptance files the mechanic
    reported. A helper under `tests/` is not one of them."""
    _given_single_domain_slice(world, 232, "Missing API, broken fixture")
    slug = "story-232-domain"
    test_file = "src/lib/paired.spec.ts"
    fixture = "tests/support/workout.ts"
    for index in range(2):
        world.mechanic_writes(
            slug,
            files={test_file: f"// attempt {index}\n"},
            test_files=[test_file],
        )
    world.given_gate_outcomes(check="fail")
    world.given_type_errors_in([test_file, fixture], ["TS2339", "TS2339"])

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "these errors are outside the acceptance tests, where this branch " in result.stdout
    assert f"may not change anything: {fixture}" in result.stdout


def test_a_non_type_lint_rule_inside_the_acceptance_tests_is_still_rejected(world):
    """`no-console` does not become true when the implementation lands, so
    it is the mechanic's to fix while the file is still hers."""
    _given_single_domain_slice(world, 233, "Missing API, stray console")
    slug = "story-233-domain"
    test_file = "src/lib/noisy.spec.ts"
    for index in range(2):
        world.mechanic_writes(
            slug,
            files={test_file: f"// attempt {index}\n"},
            test_files=[test_file],
        )
    world.given_gate_outcomes(**{"lint:changed": "fail"})
    world.given_lint_errors_in(
        [test_file, test_file],
        ["@typescript-eslint/no-unsafe-call", "no-console"],
        "Unexpected console statement.",
    )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "the implementation will not make these go away" in result.stdout
    assert "no-console" in result.stdout


def test_a_mechanic_that_refuses_with_a_reason_stops_the_run_at_once(world):
    """#423's mechanic answered "no type-correct test can be written on a
    test-only branch" three times, identically. A refusal is about the
    brief, not about the branch, so a second turn only reproduces it."""
    _given_single_domain_slice(world, 234, "A slice the mechanic refuses")
    slug = "story-234-domain"
    reason = "Acceptance tests for this slice cannot be written before the store exists."
    for _ in range(3):
        world.mechanic_writes(slug, files={}, test_files=[], why=reason, commit=False, push=False)

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert "TESTS_NOT_PUSHED (exit 23)" in result.stdout
    assert "gave a reason a retry cannot change" in result.stdout
    assert reason in result.stdout
    assert "retrying after attempt 1" not in result.stdout
    assert "exhausted 3 attempts" not in result.stdout
    assert len(_mechanic_talks(world)) == 1
    assert any(reason in comment for comment in world.issue(234)["comments"])


# --- block 1 runs the repository gate's content steps too (issue #397) ---------


def test_acceptance_tests_that_clone_themselves_are_rejected_in_block_1(world):
    """Block 3 runs the repository gate over a diff that includes the
    acceptance tests, and by then they are immutable. Block 1 runs the same
    content steps while the mechanic still owns the file (#397)."""
    _given_single_domain_slice(world, 220, "Acceptance tests without a clone")
    slug = "story-220-domain"
    test_file = "src/lib/cloned.spec.ts"
    world.mechanic_writes(
        slug,
        files={test_file: "// attempt 1: the same ten lines twice\n"},
        test_files=[test_file],
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// corrective attempt: the setup extracted into one helper\n"},
        test_files=[test_file],
    )
    world.given_gate_outcomes(**{"verify:fast": ["fail", "pass"]})
    world.given_duplicate_clone("lib/cloned.spec.ts", "lib/cloned.spec.ts")
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(220, [delegate_slice(220, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/cloned.ts": "export const cloned = true;\n"},
        changed_files=["src/lib/cloned.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "TESTS_INVALID: duplicates, format:check, check:suppressions, spellcheck failed" in (
        result.stdout
    )
    # the diagnostic says where the clone is, not merely that there is one
    assert "lib/cloned.spec.ts:40-49 ↔ lib/cloned.spec.ts:90-99 (10 lines)" in result.stdout
    assert "🔁 Mechanic #220 retrying after attempt 1" in result.stdout
    assert "🧪 Gates: duplicates, format:check, check:suppressions, spellcheck ✔" in result.stdout
    assert "Implemented #220" in result.stdout
    # the mechanic was told exactly where to look
    correction = _mechanic_talks(world)[1]["prompt"]
    assert "lib/cloned.spec.ts:40-49 ↔ lib/cloned.spec.ts:90-99" in correction


def test_acceptance_tests_that_never_pass_the_content_steps_stop_the_mechanic_early(world):
    _given_single_domain_slice(world, 221, "Tests that never stop duplicating")
    slug = "story-221-domain"
    test_file = "src/lib/always-cloned.spec.ts"
    for index in range(2):
        world.mechanic_writes(
            slug,
            files={test_file: f"// attempt {index}: still the same block twice\n"},
            test_files=[test_file],
        )
    world.given_gate_outcomes(**{"verify:fast": ["fail", "fail"]})
    world.given_duplicate_clone("lib/always-cloned.spec.ts", "lib/always-cloned.spec.ts")

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "lib/always-cloned.spec.ts:40-49" in result.stdout
    assert "Stopped: TESTS_INVALID" in "\n".join(world.issue(221)["comments"])
    assert len(_mechanic_talks(world)) == 2


def test_unformatted_acceptance_tests_are_rejected_in_block_1(world):
    """`format:check` is a content step too, and the driver names the file
    it blamed instead of only its own step name."""
    _given_single_domain_slice(world, 222, "Acceptance tests prettier accepts")
    slug = "story-222-domain"
    test_file = "src/lib/unformatted.spec.ts"
    world.mechanic_writes(
        slug,
        files={test_file: "// attempt 1: hand-formatted\n"},
        test_files=[test_file],
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// corrective attempt: prettier ran over it\n"},
        test_files=[test_file],
    )
    world.given_gate_outcomes(**{"verify:fast": ["fail", "pass"]})
    world.given_failed_gate_steps("verify:fast", "format:check")
    world.given_gate_failure_file(test_file)
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(222, [delegate_slice(222, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/unformatted.ts": "export const formatted = true;\n"},
        changed_files=["src/lib/unformatted.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "failed steps: format:check" in result.stdout
    assert f"[warn] {test_file}" in result.stdout
    assert "Implemented #222" in result.stdout


def test_misspelled_acceptance_tests_are_rejected_in_block_1(world):
    """A typo in a test file is an ordinary block 1 correction while the
    mechanic still owns the bytes. On #422 a misspelled verb in a test title
    reached block 3 instead, where the file is immutable and `cspell.json`
    is a workflow file: three solver attempts, then
    CAPACITY_EXHAUSTED."""
    _given_single_domain_slice(world, 223, "Acceptance tests cspell accepts")
    slug = "story-223-domain"
    test_file = "src/lib/badge.spec.ts"
    world.mechanic_writes(
        slug,
        files={test_file: "// attempt 1: a title with a word cspell does not know\n"},
        test_files=[test_file],
    )
    world.mechanic_writes(
        slug,
        files={test_file: "// corrective attempt: the title spelled right\n"},
        test_files=[test_file],
    )
    world.given_gate_outcomes(**{"verify:fast": ["fail", "pass"]})
    world.given_failed_gate_steps("verify:fast", "spellcheck")
    world.given_gate_failure_file(test_file)
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(223, [delegate_slice(223, "domain", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/badge.ts": "export const badge = true;\n"},
        changed_files=["src/lib/badge.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "failed steps: spellcheck" in result.stdout
    assert f"{test_file}:2277:6 - Unknown word" in result.stdout
    assert "🔁 Mechanic #223 retrying after attempt 1" in result.stdout
    assert "Implemented #223" in result.stdout
    # the mechanic was told the word and where it is, not merely that a
    # step failed
    correction = _mechanic_talks(world)[1]["prompt"]
    assert f"{test_file}:2277:6 - Unknown word" in correction


def test_a_misplaced_e2e_file_is_sent_back_to_the_mechanic_with_the_expected_folder(world):
    """#397: block 1 accepted `src/lib/components/LogRow.e2e.ts`, the
    coverage lane counted it as source that no unit test loads, and CI was
    deterministically red on the pull request where the file's bytes were
    already immutable."""
    world.given_story(97, title="Misplaced e2e", labels=["story"])
    world.planner_answers_whose_call(
        97,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        97,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "ui",
                "title": "Misplaced e2e",
                "brief": "Write the missing acceptance test.",
                "acceptance": ["The row renders three lines."],
                "test_kind": "playwright",
            }
        ],
    )
    slug = "story-97-ui"
    misplaced = "src/lib/components/LogRow.e2e.ts"
    placed = "src/routes/log-row.e2e.ts"
    world.mechanic_writes(slug, files={misplaced: "// failing\n"}, test_files=[misplaced])
    world.mechanic_writes(
        slug, files={placed: "// failing\n"}, test_files=[placed], delete=[misplaced]
    )
    world.scripted_test_outcome(placed, ["fail", "pass"])
    world.planner_answers_delegate(97, [delegate_slice(97, "ui", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/components/LogRow.svelte": "<p>row</p>\n"},
        changed_files=["src/lib/components/LogRow.svelte"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"{misplaced} is in the wrong folder on {slug}" in result.stdout
    assert "must live under src/routes/" in result.stdout
    assert "move it to src/routes/LogRow.e2e.ts" in result.stdout
    assert "Mechanic #97 (ui) attempt 2/3" in result.stdout


def _given_single_ui_slice(world, number: int, title: str) -> None:
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
                "layer": "ui",
                "title": title,
                "brief": "Write the missing acceptance test.",
                "acceptance": ["The missing behavior is visible at 360px."],
                "test_kind": "playwright",
            }
        ],
    )


def test_a_playwright_test_that_times_out_counts_as_failing_as_intended(world):
    """The real shape of a UI acceptance test with no implementation: the
    expectation waits for an element that never appears and playwright
    reports `timedOut`, not `failed`. Block 1 counted only `failed` and
    rejected three correct attempts of story #421 as TESTS_DO_NOT_FAIL."""
    _given_single_ui_slice(world, 120, "Today's row is marked")
    slug = "story-120-ui"
    test_file = "src/routes/plan.e2e.ts"
    world.mechanic_writes(slug, files={test_file: "// failing\n"}, test_files=[test_file])
    world.scripted_test_outcome(test_file, ["timed_out", "pass"])
    world.planner_answers_delegate(120, [delegate_slice(120, "ui", mechanic_signals())])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/routes/plan/+page.svelte": "<p>Today, </p>\n"},
        changed_files=["src/routes/plan/+page.svelte"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"🧪 {test_file} → failed, as it should ✔" in result.stdout
    assert "passed with no implementation" not in result.stdout


def test_a_playwright_file_whose_tests_all_pass_is_rejected_naming_each_test_status(world):
    """The rejection has to say what the runner saw, test by test, or the
    mechanic cannot tell which assertion did not bite."""
    _given_single_ui_slice(world, 121, "Already satisfied")
    slug = "story-121-ui"
    test_file = "src/routes/already.e2e.ts"
    titles = ["the row shows the Today prefix", "the row is bold"]
    world.mechanic_writes(slug, files={test_file: "// passes\n"}, test_files=[test_file])
    world.scripted_test_outcome(test_file, "pass", titles=titles)
    world.mechanic_replies(slug, [test_file])
    world.mechanic_replies(slug, [test_file])

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert f"playwright {test_file} passed with no implementation" in result.stdout
    assert "the runner reported:" in result.stdout
    for title in titles:
        assert f'"{title}" → passed' in result.stdout
    # the same verdict twice: the third attempt would only reproduce it
    assert "stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "1 of 3 attempts went unspent" in result.stdout


def test_a_playwright_file_whose_tests_are_all_skipped_is_rejected(world):
    """Skipped is neither passing nor failing: nothing ran, so nothing was
    proved, and block 1 must not read it as a failing acceptance test."""
    _given_single_ui_slice(world, 122, "Everything skipped")
    slug = "story-122-ui"
    test_file = "src/routes/skipped.e2e.ts"
    world.mechanic_writes(slug, files={test_file: "// skipped\n"}, test_files=[test_file])
    world.scripted_test_outcome(test_file, "skipped")
    world.mechanic_replies(slug, [test_file])
    world.mechanic_replies(slug, [test_file])

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert f"playwright {test_file} only skipped its tests, so none of them ran" in result.stdout
    assert '"the behavior this slice asks for" → skipped' in result.stdout
