"""End-to-end tests for go.py: black-box, subprocess only. No unit tests of
any helper - every assertion is on go.py's exit code, its log, and the
resulting fake-world state.
"""

from conftest import run_flow


def test_picks_lowest_unheld_story_with_one_slice(world):
    world.given_story(130, title="Faster first paint", labels=["story"])
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
    world.scripted_test_run(1)

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
    assert "🏁 Planned #130" in result.stdout


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
        files={"src/lib/merge.spec.ts": "// failing\n"},
        test_files=["src/lib/merge.spec.ts"],
    )
    world.scripted_test_run(1)
    world.mechanic_writes(
        "story-1001-ui",
        files={"src/routes/merge.e2e.ts": "// failing\n"},
        test_files=["src/routes/merge.e2e.ts"],
    )
    world.scripted_test_run(1)

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
    world.scripted_test_run(1)

    result = run_flow(world, "20")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "in-progress" in world.issue(20)["labels"]
    assert "in-progress" not in world.issue(10)["labels"]


def test_nothing_to_pick_when_every_story_is_held(world):
    world.given_story(30, title="Held story", labels=["story", "paused"])

    result = run_flow(world)

    assert result.returncode == 10, result.stdout + result.stderr
    assert world.issue(30)["labels"] == ["story", "paused"]
    assert world.calls() == [] or all(
        c.get("argv", [None])[0:2] != ["issue", "comment"] for c in world.calls()
    )


import pytest as _pytest  # noqa: E402


@_pytest.mark.parametrize(
    "state,labels",
    [
        ("CLOSED", ["story"]),
        ("OPEN", ["story", "in-progress"]),
        ("OPEN", []),
    ],
)
def test_explicit_issue_that_is_held_or_closed_or_not_a_story_is_not_pickable(world, state, labels):
    world.given_story(40, title="Bad pick", labels=labels, state=state)

    result = run_flow(world, "40")

    assert result.returncode == 20, result.stdout + result.stderr


def test_gabriels_call_hands_off_without_a_worktree_or_mechanic(world):
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


def test_spending_flagged_pauses_without_a_slicing_turn(world):
    world.given_story(60, title="Costly change", labels=["story"])
    world.planner_answers_whose_call(
        60,
        owner="orchestrator",
        category="none",
        reason="r",
        question="",
        options=[],
        recommendation="",
    )

    result = run_flow(world, "--spend-flagged", "60")

    assert result.returncode == 12, result.stdout + result.stderr
    issue = world.issue(60)
    assert "paused" in issue["labels"]
    assert any("spending is flagged" in c.lower() for c in issue["comments"])
    assert not any(c.get("argv", [None])[:1] == ["slices"] for c in world.calls())


def test_planner_turn_failing_stops_the_flow_with_a_comment(world):
    world.given_story(70, title="Bad planner", labels=["story"])
    world.planner_fails(70, message="planner crashed")

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    issue = world.issue(70)
    assert any("stopped" in c.lower() for c in issue["comments"])


def test_planner_breaking_the_slice_contract_is_a_hard_stop(world):
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
    world.planner_answers_slices(
        80,
        spans_domain_and_ui=True,
        slices=[
            {
                "layer": "domain",
                "title": "Only one slice",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )

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

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert not world.branch_exists_on_origin("story-90-domain")


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

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr


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
    world.scripted_test_run(0)

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr


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
    import subprocess

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


def test_planner_worktree_is_removed_even_when_the_run_fails(world):
    world.given_story(120, title="Cleanup check", labels=["story"])
    world.planner_fails(120, message="boom")

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    assert not world.planner_worktree_path(120).exists()
