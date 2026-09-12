"""End-to-end tests for block 4: integration branch, PR, the mechanical
predicate, the reviewer loop with its fix rounds, claims/CI with the one
counted rerun, and the merge. Black-box like the other suites: every
assertion is on go.py's exit code, its log, and the fake-world state after
the run.
"""

import json

from conftest import (
    builder_signals,
    delegate_slice,
    mechanic_signals,
    run_flow,
)


def _option(argv: list[str], name: str) -> str:
    return argv[argv.index(name) + 1]


def _given_planned_story(
    world, number: int, layer: str = "domain", test_kind: str = "vitest"
) -> str:
    """Script the whole of block 1: one slice, failing tests written,
    validated and pushed. Returns the acceptance test file."""
    world.given_story(number, title="Delivered story", labels=["story"])
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
                "layer": layer,
                "title": "Delivered work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": test_kind,
            }
        ],
    )
    slug = f"story-{number}-{layer}"
    test_file = "src/lib/deliver.spec.ts" if test_kind == "vitest" else "src/routes/deliver.e2e.ts"
    world.mechanic_writes(slug, files={test_file: "// failing\n"}, test_files=[test_file])
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    return test_file


def _given_planned_split(world, number: int, same_file: bool = False) -> tuple[str, str]:
    world.given_story(number, title="Split delivery", labels=["story"])
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
    domain_test = "src/lib/split.spec.ts"
    ui_test = "src/routes/split.e2e.ts"
    world.mechanic_writes(
        "story-1000-domain", files={domain_test: "// failing\n"}, test_files=[domain_test]
    )
    world.mechanic_writes("story-1001-ui", files={ui_test: "// failing\n"}, test_files=[ui_test])
    world.scripted_test_outcome(domain_test, ["fail", "pass"])
    world.scripted_test_outcome(ui_test, ["fail", "pass"])
    if same_file:
        # both slices legitimately touch one shared non-layer file; the
        # integration merge is where the overlap surfaces
        world.agent_implements(
            "story-1000-domain",
            "mechanic",
            files={"src/lib/shared.ts": "export const domain = 1;\n"},
            changed_files=["src/lib/shared.ts"],
        )
        world.agent_implements(
            "story-1001-ui",
            "mechanic",
            files={"src/lib/shared.ts": "export const ui = 2;\n"},
            changed_files=["src/lib/shared.ts"],
        )
    return domain_test, ui_test


def _implement(world, slug: str, role: str, files: dict[str, str], **kwargs) -> None:
    world.agent_implements(slug, role, files=files, changed_files=sorted(files), **kwargs)


def _delegate(world, number: int, layer: str, signals: dict) -> None:
    world.planner_answers_delegate(number, [delegate_slice(number, layer, signals)])


def _gh_calls(world) -> list[dict]:
    return [call for call in world.calls() if call.get("tool") == "gh"]


def _aarmy_roles(world) -> list[str]:
    return [
        call["argv"][1]
        for call in world.calls()
        if call.get("tool") == "aarmy" and len(call["argv"]) > 1 and call["argv"][0] == "talk"
    ]


def _pr(world, number: int) -> dict:
    """The fake gh's PR record, read from disk: the run happened in other
    processes, so the fixture's in-memory world is stale."""
    path = world.dir / "world.json"
    data = json.loads(path.read_text())
    return data.get("prs", {}).get(str(number), {})


def test_mechanical_delivery_merges_without_a_reviewer(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", mechanic_signals())
    _implement(
        world, "story-1000-domain", "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "reviewer" not in _aarmy_roles(world)
    gh_argv = [" ".join(call["argv"][:2]) for call in _gh_calls(world)]
    assert "pr create" in gh_argv
    assert "pr merge" in gh_argv
    assert _pr(world, 500)["state"] == "MERGED"
    assert "Closes #1000" in _pr(world, 500)["body"]
    assert world.branch_exists_on_origin("story-1000")
    assert any("Delivered" in comment for comment in world.issue(1000)["comments"])


def test_reviewed_delivery_merges_on_a_merge_verdict(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", builder_signals())
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.reviewer_answers(1000, "merge")

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert _aarmy_roles(world).count("reviewer") == 1
    assert _pr(world, 500)["state"] == "MERGED"


def test_review_fix_round_refreezes_and_merges(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", builder_signals())
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.reviewer_answers(
        1000,
        "fix",
        [
            {
                "file": "src/lib/delivered.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "the constant must be 2",
            }
        ],
    )
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 2;\n"}
    )
    world.reviewer_answers(1000, "merge")

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert _aarmy_roles(world).count("reviewer") == 2
    assert _pr(world, 500)["state"] == "MERGED"
    state = json.loads((world.home / "runs" / "story-1000.json").read_text())
    piece = state["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert any(turn["kind"] == "review_fix" for turn in piece["turns"])


def test_reviewer_exhaustion_stops_and_needs_gabriel(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", builder_signals())
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    finding = [
        {
            "file": "src/lib/delivered.ts",
            "line": 1,
            "category": "correctness",
            "required_fix": "still wrong",
        }
    ]
    world.reviewer_answers(1000, "fix", finding)
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 2;\n"}
    )
    world.reviewer_answers(1000, "fix", finding)
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 3;\n"}
    )

    result = run_flow(world, "1000")

    assert result.returncode == 28, result.stdout + result.stderr
    assert "needs-gabriel" in world.issue(1000)["labels"]
    assert "blocked" in world.issue(1000)["labels"]
    assert _pr(world, 500)["state"] == "OPEN"


def test_ci_red_is_rerun_once_then_green_merges(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", mechanic_signals())
    _implement(
        world, "story-1000-domain", "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.given_checks(500, ["fail", "pass"])

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    gh_argv = [" ".join(call["argv"][:2]) for call in _gh_calls(world)]
    assert gh_argv.count("run rerun") == 1
    assert _pr(world, 500)["state"] == "MERGED"


def test_ci_red_after_the_one_rerun_stops(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", mechanic_signals())
    _implement(
        world, "story-1000-domain", "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.given_checks(500, ["fail", "fail"])

    result = run_flow(world, "1000")

    assert result.returncode == 28, result.stdout + result.stderr
    assert "blocked" in world.issue(1000)["labels"]
    gh_argv = [" ".join(call["argv"][:2]) for call in _gh_calls(world)]
    assert gh_argv.count("run rerun") == 1
    assert "pr merge" not in gh_argv


def test_ci_pending_past_the_timeout_is_a_tool_failure(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", mechanic_signals())
    _implement(
        world, "story-1000-domain", "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.given_checks(500, "pending")

    result = run_flow(world, "1000", env_extra={"FIT_FLOW_CI_TIMEOUT": "0"})

    assert result.returncode == 26, result.stdout + result.stderr
    assert "pr merge" not in " ".join(" ".join(call["argv"]) for call in _gh_calls(world))


def test_ci_without_the_required_check_is_a_tool_failure(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", mechanic_signals())
    _implement(
        world, "story-1000-domain", "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.given_checks(500, "no_all_green")

    result = run_flow(world, "1000")

    assert result.returncode == 26, result.stdout + result.stderr


def test_merge_conflict_between_slices_stops_for_a_replan(world):
    _given_planned_split(world, 1000, same_file=True)
    world.planner_answers_delegate(
        1000,
        [
            delegate_slice(1000, "domain", mechanic_signals()),
            delegate_slice(1000, "ui", mechanic_signals()),
        ],
    )

    result = run_flow(world, "1000")

    assert result.returncode == 27, result.stdout + result.stderr
    assert "blocked" in world.issue(1000)["labels"]
    assert _pr(world, 500) == {}


def test_a_phantom_finding_is_a_contract_failure(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", builder_signals())
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.reviewer_answers(
        1000,
        "fix",
        [
            {
                "file": "src/lib/phantom.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "this file does not exist",
            }
        ],
    )

    result = run_flow(world, "1000")

    assert result.returncode == 22, result.stdout + result.stderr
    assert _pr(world, 500)["state"] == "OPEN"


def test_a_reviewer_that_writes_is_a_contract_failure(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", builder_signals())
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.reviewer_writes(1000, {"src/lib/delivered.ts": "export const tampered = true;\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 22, result.stdout + result.stderr
    assert _pr(world, 500)["state"] == "OPEN"


def test_pr_creation_failure_is_a_tool_failure(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", mechanic_signals())
    _implement(
        world, "story-1000-domain", "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world.gh_fails_on("pr create")

    result = run_flow(world, "1000")

    assert result.returncode == 26, result.stdout + result.stderr
    assert world.branch_exists_on_origin("story-1000")


def test_malformed_reviewer_replies_are_corrected_then_accepted(world):
    _given_planned_story(world, 1000)
    _delegate(world, 1000, "domain", builder_signals())
    _implement(
        world, "story-1000-domain", "builder", {"src/lib/delivered.ts": "export const ok = 1;\n"}
    )
    world._queue_turn(
        "story-1000-review/reviewer",
        {"verdict": "approve", "findings": []},
    )
    world.reviewer_answers(1000, "merge")

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert _aarmy_roles(world).count("reviewer") == 2
    assert _pr(world, 500)["state"] == "MERGED"
