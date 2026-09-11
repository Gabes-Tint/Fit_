"""End-to-end tests for go.py: black-box, subprocess only. No unit tests of
any helper - every assertion is on go.py's exit code, its log, and the
resulting fake-world state.
"""

import subprocess

import pytest

from conftest import run_flow


def _aarmy_talks(world):
    return [c for c in world.calls() if c.get("tool") == "aarmy" and c["argv"][0] == "talk"]


def test_picks_lowest_story_not_held_with_one_slice(world):
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
    team_name = "issue-130"
    world.mechanic_writes(
        team_name,
        files={"src/lib/paint.spec.ts": "// failing spec\n"},
        test_files=["src/lib/paint.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/paint.spec.ts", "fail")

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    issue = world.issue(130)
    assert "in-progress" in issue["labels"]
    assert any("brief" in c.lower() or "trim the log" in c.lower() for c in issue["comments"])
    assert world.branch_exists_on_origin(team_name)
    assert world.issue_worktree_path(130).exists()
    assert (world.team_dir(130) / "worktree").is_symlink()
    talks = _aarmy_talks(world)
    assert any(c["argv"][3] == team_name for c in talks if c["argv"][1] == "planner")
    assert "📥 Sync: fetched origin" in result.stdout
    assert '📋 Picked #130 "Faster first paint"' in result.stdout
    assert f"👥 Team {team_name} · new worktree" in result.stdout
    assert "🔀 Whose call? → 🧑‍💻 orchestrator's" in result.stdout
    assert "🔀 Spending flagged? → no, carry on" in result.stdout
    assert "Slice 1:" in result.stdout
    assert "Trim the log screen's first render." in result.stdout
    assert "the behavior is not implemented yet" in result.stdout
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
        "issue-1000",
        files={"src/lib/merge.spec.ts": "// failing\n"},
        test_files=["src/lib/merge.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/merge.spec.ts", "fail")
    world.mechanic_writes(
        "issue-1001",
        files={"src/routes/merge.e2e.ts": "// failing\n"},
        test_files=["src/routes/merge.e2e.ts"],
    )
    world.scripted_test_outcome("src/routes/merge.e2e.ts", "fail")

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    domain_child = world.issue(1000)
    ui_child = world.issue(1001)
    assert set(domain_child["labels"]) >= {"story", "in-progress"}
    assert set(ui_child["labels"]) >= {"story", "in-progress"}
    assert "part of #140" in domain_child["body"].lower()
    assert "part of #140" in ui_child["body"].lower()
    assert world.branch_exists_on_origin("issue-1000")
    assert world.branch_exists_on_origin("issue-1001")
    story_comments = " ".join(world.issue(140)["comments"]).lower()
    assert "#1000" in story_comments
    assert "#1001" in story_comments

    talks = _aarmy_talks(world)
    mechanic_teams = {c["argv"][3] for c in talks if c["argv"][1] == "mechanic"}
    assert mechanic_teams == {"issue-1000", "issue-1001"}
    for name in ("issue-140", "issue-1000", "issue-1001"):
        assert (world.team_dir(int(name.split("-")[1])) / "worktree").is_symlink()


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
        "issue-20",
        files={"src/lib/x.spec.ts": "// failing\n"},
        test_files=["src/lib/x.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/x.spec.ts", "fail")

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


def test_gabriel_owning_the_call_hands_off_without_a_mechanic(world):
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
    # The planner still needed a worktree to run the "whose call?" turn in.
    assert world.issue_worktree_path(50).exists()
    assert not any(
        c.get("tool") == "aarmy" and c["argv"][1] == "mechanic" for c in world.calls()
    )
    assert "Question:" in result.stdout
    assert "Should we buy the API plan?" in result.stdout
    assert "Options:" in result.stdout
    assert "Buy the plan" in result.stdout


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
    assert "🔀 Spending flagged? → yes, pausing" in result.stdout
    assert len(_aarmy_talks(world)) == 1


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
                {"layer": "domain", "title": "a", "brief": "b", "acceptance": ["a"], "test_kind": "vitest"},
                {"layer": "ui", "title": "c", "brief": "d", "acceptance": ["a"], "test_kind": "playwright"},
            ],
        ),
        (
            True,
            [{"layer": "domain", "title": "a", "brief": "b", "acceptance": ["a"], "test_kind": "vitest"}],
        ),
        (
            True,
            [
                {"layer": "ui", "title": "a", "brief": "b", "acceptance": ["a"], "test_kind": "playwright"},
                {"layer": "domain", "title": "c", "brief": "d", "acceptance": ["a"], "test_kind": "vitest"},
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


def test_planner_leaving_a_file_in_the_worktree_is_a_hard_stop(world):
    world.given_story(85, title="Messy planner", labels=["story"])
    world.planner_leaves_a_file(85, "src/lib/oops.ts")

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(85)["comments"])
    assert any("left changes" in c.lower() for c in world.issue(85)["comments"])


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
        "issue-90",
        files={"src/lib/y.spec.ts": "// failing\n"},
        test_files=["src/lib/y.spec.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert not world.branch_exists_on_origin("issue-90")
    assert any("stopped" in c.lower() for c in world.issue(90)["comments"])


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
        "issue-95",
        files={"src/lib/z.spec.ts": "// failing\n", "src/lib/z.ts": "export const z = 1;\n"},
        test_files=["src/lib/z.spec.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 23, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(95)["comments"])


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
        "issue-100",
        files={"src/lib/w.spec.ts": "// passes\n"},
        test_files=["src/lib/w.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/w.spec.ts", "pass")

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(100)["comments"])


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
        "issue-105",
        files={"src/routes/gone.e2e.ts": "// failing\n"},
        test_files=["src/routes/gone.e2e.ts"],
    )
    world.scripted_test_outcome("src/routes/gone.e2e.ts", "not_found")

    result = run_flow(world)

    assert result.returncode == 24, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(105)["comments"])


def test_issue_worktree_on_another_branch_cannot_be_reused(world):
    world.given_story(110, title="Wrong branch", labels=["story"])
    subprocess.run(
        [
            "git",
            "worktree",
            "add",
            "-b",
            "some-other-branch",
            str(world.issue_worktree_path(110)),
            "origin/main",
        ],
        cwd=world.repo,
        check=True,
        capture_output=True,
    )

    result = run_flow(world)

    assert result.returncode == 25, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(110)["comments"])


def test_issue_worktree_with_uncommitted_changes_cannot_be_reused(world):
    world.given_story(112, title="Dirty worktree", labels=["story"])
    subprocess.run(
        [
            "git",
            "worktree",
            "add",
            "-b",
            "issue-112",
            str(world.issue_worktree_path(112)),
            "origin/main",
        ],
        cwd=world.repo,
        check=True,
        capture_output=True,
    )
    (world.issue_worktree_path(112) / "dirty.txt").write_text("uncommitted\n")

    result = run_flow(world)

    assert result.returncode == 25, result.stdout + result.stderr
    assert any("stopped" in c.lower() for c in world.issue(112)["comments"])


def test_a_rerun_after_a_needs_gabriel_stop_reuses_the_team_and_worktree(world):
    world.given_story(130, title="Ask first", labels=["story"])
    world.planner_answers_whose_call(
        130,
        owner="gabriel",
        category="product",
        reason="needs a product call",
        question="Ship it?",
        options=["Ship it"],
        recommendation="Ship it",
    )

    first = run_flow(world)
    assert first.returncode == 11, first.stdout + first.stderr
    assert world.issue_worktree_path(130).exists()

    # Gabriel answers; the label comes off between runs, as it would for
    # real once he replies.
    world.given_story(130, title="Ask first", labels=["story"])
    world.planner_answers_whose_call(
        130,
        owner="orchestrator",
        category="none",
        reason="Gabriel said go",
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
                "title": "Ask first",
                "brief": "b",
                "acceptance": ["a"],
                "test_kind": "vitest",
            }
        ],
    )
    world.mechanic_writes(
        "issue-130",
        files={"src/lib/ask.spec.ts": "// failing\n"},
        test_files=["src/lib/ask.spec.ts"],
    )
    world.scripted_test_outcome("src/lib/ask.spec.ts", "fail")

    second = run_flow(world)

    assert second.returncode == 0, second.stdout + second.stderr
    worktree_new_calls = [
        c
        for c in world.calls()
        if c.get("tool") == "bun" and c["argv"][:2] == ["run", "worktree:new"]
    ]
    assert len(worktree_new_calls) == 1
