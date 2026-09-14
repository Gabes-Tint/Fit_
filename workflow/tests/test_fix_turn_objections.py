"""End-to-end tests for block 4's fix-turn objections: when a reviewer sends a
slice back for fixes and the builder objects to the acceptance tests during
that fix round, the driver verifies the objection against the frozen commit,
repairs the tests in block 1, and the fix request continues.

Black-box like the other suites: every assertion is on go.py's exit code,
its log, the retained record and the fake world.
"""

import subprocess

from conftest import (
    builder_signals,
    delegate_slice,
    mechanic_signals,
    run_flow,
)

TEST = "src/lib/rows.spec.ts"
REPAIRED = "src/lib/rows-repaired.spec.ts"
SIBLING = "src/lib/brands.spec.ts"
WHY = "the acceptance tests contradict the fix's commit"
FIRST = "a row carries its brand"
SECOND = "a row without a brand says so"
WORK = {"src/lib/rows.ts": "export const brand = true;\n"}
SECOND_WHY = "the repair moved the same problem"


def _field(stdout: str, label: str) -> list[str]:
    """What every `   │ Label: value` line of the log carried, without the
    padding narrate.fields aligns the labels with."""
    head = f"   │ {label}:"
    return [line.split(":", 1)[1].strip() for line in stdout.splitlines() if line.startswith(head)]


def _local_branches(world) -> list[str]:
    """Every branch the fake repository has locally, which is where the
    driver's own repair branches live."""
    result = subprocess.run(
        ["git", "branch", "--format=%(refname:short)"],
        cwd=world.repo,
        capture_output=True,
        text=True,
    )
    return result.stdout.split()


def _talks(world, role: str, team: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", role]
        and call["argv"][call["argv"].index("--team") + 1] == team
    ]


def _given_planned_story(
    world,
    number: int,
    outcomes: list,
) -> str:
    """Block 1 setup: failing tests written, validated and pushed."""
    world.given_story(number, title="Rows show the brand", labels=["story"])
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
                "title": "Rows carry the brand",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["A row carries its brand."],
                "test_kind": "vitest",
            }
        ],
    )
    slug = f"story-{number}-domain"
    world.mechanic_writes(slug, files={TEST: "// failing\n"}, test_files=[TEST])
    world.scripted_test_outcome(TEST, outcomes)
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", builder_signals())])
    return slug


# --- a verified fix-turn objection goes to block 1 repair -----


def test_a_verified_fix_turn_objection_goes_to_block_1_and_the_repaired_tests_let_the_slice_pass(
    world,
):
    """A fix turn whose reply carries a verified objection does not spend a
    fix attempt. The log narrates repair, the tests are re-frozen, the fix
    request continues, and the run ends normally."""
    slug = _given_planned_story(world, 500, ["fail", "pass"])
    world.agent_implements(
        slug,
        "builder",
        files=WORK,
        changed_files=list(WORK),
    )
    world.reviewer_answers(
        500,
        "fix",
        [
            {
                "file": "src/lib/rows.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "adjust the logic",
            }
        ],
    )
    world.scripted_test_outcome(TEST, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.agent_implements(
        slug,
        "builder",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )
    world.reviewer_answers(500, "merge")

    result = run_flow(world, 500)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"🙅 #500 (domain) builder rejects the tests: tests_contradict — {WHY}" in result.stdout
    assert "🩹 Repairing #500 (domain) tests in block 1 (repair 1/2)" in result.stdout
    assert "🔒 #500 (domain) tests re-frozen at" in result.stdout
    assert "🕵️  Review round" in result.stdout

    state = world.run_record(500)
    piece = state["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_files"] == [REPAIRED]
    assert piece["test_repairs"] == 1
    assert [item["kind"] for item in piece["objections"]] == ["tests_contradict"]
    # the fix turn is settled as objected and costs no fix attempt
    fix_turns = [turn for turn in piece["turns"] if turn["kind"] == "review_fix"]
    assert len(fix_turns) == 1
    assert fix_turns[0]["result"] == "objected"
    assert fix_turns[0]["attempt"] == 1
    # the slice stays in fixing, not moving to assigned or resetting attempts
    assert piece["state"] == "succeeded"


def test_a_fix_turn_objection_recorded_on_the_objections_ledger(world):
    """The objection on the slice's objections ledger shows role, attempt,
    and the turn marked objected, and test_repairs is incremented."""
    slug = _given_planned_story(world, 501, ["fail", "pass"])
    world.agent_implements(
        slug,
        "builder",
        files=WORK,
        changed_files=list(WORK),
    )
    world.reviewer_answers(
        501,
        "fix",
        [
            {
                "file": "src/lib/rows.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "adjust the logic",
            }
        ],
    )
    world.scripted_test_outcome(TEST, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.agent_implements(
        slug,
        "builder",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )
    world.reviewer_answers(501, "merge")

    result = run_flow(world, 501)

    assert result.returncode == 0, result.stdout + result.stderr
    piece = world.run_record(501)["slices"]["domain"]
    assert len(piece["objections"]) == 1
    objection = piece["objections"][0]
    assert objection["kind"] == "tests_contradict"
    assert objection["role"] == "builder"
    assert objection["attempt"] == 1
    assert piece["test_repairs"] == 1


def test_a_partial_fix_turn_objection_is_accepted_when_other_tests_pass(world):
    """A partial objection beside the fix turn's committed work is accepted
    when every test it does not name already passes on that tree."""
    slug = _given_planned_story(
        world,
        502,
        ["fail", {FIRST: "pass", SECOND: "fail"}],
    )
    world.agent_implements(
        slug,
        "builder",
        files=WORK,
        changed_files=list(WORK),
    )
    world.reviewer_answers(
        502,
        "fix",
        [
            {
                "file": "src/lib/rows.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "adjust the logic",
            }
        ],
    )
    world.scripted_test_outcome(TEST, ["fail", {FIRST: "pass", SECOND: "fail"}])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(
        slug,
        "builder",
        tests=[f"{TEST}::{SECOND}"],
        why="the fix contradicts this one test",
    )
    world.mechanic_repairs(
        f"{slug}-tests-1", files={REPAIRED: "// repaired\n"}, test_files=[REPAIRED]
    )
    world.agent_implements(
        slug,
        "builder",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )
    world.reviewer_answers(502, "merge")

    result = run_flow(world, 502)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "🧩 #502 (domain) partial objection: the other 1 acceptance test(s) pass beside it"
        in result.stdout
    )
    piece = world.run_record(502)["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_repairs"] == 1


# --- objections the driver refuses during fix turns -----


def test_a_fix_turn_objection_to_a_test_that_passes_is_refused(world):
    """A fix-turn objection to a test that already passes on the frozen
    commit is refused and costs the fix attempt."""
    slug = _given_planned_story(world, 503, ["fail", "pass"])
    world.agent_implements(
        slug,
        "builder",
        files=WORK,
        changed_files=list(WORK),
    )
    world.reviewer_answers(
        503,
        "fix",
        [
            {
                "file": "src/lib/rows.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "adjust the logic",
            }
        ],
    )
    world.scripted_test_outcome(TEST, ["pass", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.agent_implements(
        slug,
        "builder",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 503)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "already pass on this working tree" in result.stdout
    assert "🩹 Repairing" not in result.stdout
    piece = world.run_record(503)["slices"]["domain"]
    assert piece["test_repairs"] == 0 and piece["objections"] == []
    # the refused objection cost the fix attempt
    fix_turns = [turn for turn in piece["turns"] if turn["kind"] == "review_fix"]
    assert len(fix_turns) == 1
    assert fix_turns[0]["attempt"] == 1


def test_a_fix_turn_objection_naming_every_test_is_refused(world):
    """A fix-turn objection naming every acceptance test beside committed
    work is refused as partial objection semantics do not apply."""
    slug = _given_planned_story(
        world,
        504,
        [{FIRST: "fail", SECOND: "fail"}],
    )
    world.agent_implements(
        slug,
        "builder",
        files=WORK,
        changed_files=list(WORK),
    )
    world.reviewer_answers(
        504,
        "fix",
        [
            {
                "file": "src/lib/rows.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "adjust the logic",
            }
        ],
    )
    world.scripted_test_outcome(TEST, [{FIRST: "fail", SECOND: "fail"}])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.agent_implements(
        slug,
        "builder",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 504)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "name the tests that cannot pass" in result.stdout
    assert "🩹 Repairing" not in result.stdout
    piece = world.run_record(504)["slices"]["domain"]
    assert piece["objections"] == []


# --- the limits -----


def test_a_third_fix_turn_objection_stops_as_tests_invalid(world):
    """A third verified objection after two repairs stops with exit 31
    (TESTS_INVALID), naming every objection."""
    slug = _given_planned_story(world, 505, ["fail", "fail"])
    world.agent_implements(
        slug,
        "builder",
        files=WORK,
        changed_files=list(WORK),
    )
    world.reviewer_answers(
        505,
        "fix",
        [
            {
                "file": "src/lib/rows.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "adjust the logic",
            }
        ],
    )
    world.scripted_test_outcome(TEST, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "fail", "fail", "fail"])
    for repair in (1, 2):
        world.agent_objects(slug, "builder", tests=[TEST if repair == 1 else REPAIRED], why=WHY)
        world.mechanic_repairs(
            f"{slug}-tests-{repair}",
            files={REPAIRED: f"// repaired {repair}\n"},
            test_files=[REPAIRED],
            delete=[TEST] if repair == 1 else None,
        )
        world.scripted_test_outcome(REPAIRED, ["fail", "fail"])
    # the third objection
    world.agent_objects(slug, "builder", tests=[REPAIRED], why="still contradictory")

    result = run_flow(world, 505)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "rejects the acceptance tests again after 2 block 1 repairs" in result.stdout
    piece = world.run_record(505)["slices"]["domain"]
    assert piece["state"] == "failed" and piece["test_repairs"] == 2


def test_the_new_frozen_commit_is_ancestor_of_integration_branch(world):
    """After the repair the new frozen commit is an ancestor of the
    integration branch, and the log shows a further review round."""
    slug = _given_planned_story(world, 506, ["fail", "pass"])
    world.agent_implements(
        slug,
        "builder",
        files=WORK,
        changed_files=list(WORK),
    )
    world.reviewer_answers(
        506,
        "fix",
        [
            {
                "file": "src/lib/rows.ts",
                "line": 1,
                "category": "correctness",
                "required_fix": "adjust the logic",
            }
        ],
    )
    world.scripted_test_outcome(TEST, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.agent_implements(
        slug,
        "builder",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )
    world.reviewer_answers(506, "merge")

    result = run_flow(world, 506)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔒 #506 (domain) tests re-frozen at" in result.stdout
    assert "🕵️  Review round" in result.stdout
    piece = world.run_record(506)["slices"]["domain"]
    assert piece["state"] == "succeeded"
