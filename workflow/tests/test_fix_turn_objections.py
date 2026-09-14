"""End-to-end tests for block 4's fix-turn objections: when a reviewer sends a
slice back for fixes and the builder objects to the acceptance tests during
that fix round, the driver verifies the objection against the freeze commit
the fix request started from, repairs the tests in block 1, and the fix
request continues.

Black-box like the other suites: every assertion is on go.py's exit code,
its log, the retained record and the fake world.

Every acceptance runner invocation takes one scripted outcome, in order:
block 1's check, block 3's validation, each objection's verification, each
repair's validation and each fix turn's validation.
"""

import re
import subprocess

from conftest import (
    builder_signals,
    delegate_slice,
    run_flow,
)

TEST = "src/lib/rows.spec.ts"
REPAIRED = "src/lib/rows-repaired.spec.ts"
WHY = "the acceptance tests contradict the fix's commit"
FIRST = "a row carries its brand"
SECOND = "a row without a brand says so"
WORK = {"src/lib/rows.ts": "export const brand = true;\n"}
# what a fix turn types: each one differs from the frozen work and from the
# turn before it, so no fix turn is a no-op (#422)
FIX = {"src/lib/rows.ts": 'export const brand = "adjusted";\n'}
FIX_WORK = {"src/lib/rows.ts": "export const brand = 1;\n"}


def _given_reviewed_story(world, number: int, titles: list[str] | None = None) -> str:
    """Blocks 1-3 and the first review: failing tests written and frozen, the
    builder's work validated, and the reviewer sends the slice back for a
    fix. The acceptance outcomes are the test's own to script."""
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
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", builder_signals())])
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(
        number,
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
    return slug


def _given_verified_objection(world, number: int) -> str:
    """The first fix turn objects to the whole acceptance file, which still
    fails on its tree; block 1 replaces it, and the fix request goes on to a
    turn that passes and a review that merges."""
    slug = _given_reviewed_story(world, number)
    world.scripted_test_outcome(TEST, ["fail", "pass", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.agent_implements(slug, "builder", files=FIX, changed_files=list(FIX))
    world.reviewer_answers(number, "merge")
    return slug


def _fix_turns(piece: dict) -> list[dict]:
    return [turn for turn in piece["turns"] if turn["kind"] == "review_fix"]


# --- a verified fix-turn objection goes to block 1 repair -----


def test_a_verified_fix_turn_objection_goes_to_block_1_and_the_repaired_tests_let_the_slice_pass(
    world,
):
    """A fix turn whose reply carries a verified objection does not spend a
    fix attempt. The log narrates repair, the tests are re-frozen, the fix
    request continues, and the run ends normally."""
    _given_verified_objection(world, 500)

    result = run_flow(world, 500)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"🙅 #500 (domain) builder rejects the tests: tests_contradict — {WHY}" in result.stdout
    assert "🩹 Repairing #500 (domain) tests in block 1 (repair 1/2)" in result.stdout
    assert "🔒 #500 (domain) tests re-frozen at" in result.stdout

    piece = world.run_record(500)["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_files"] == [REPAIRED]
    # the objecting turn is not a fix attempt spent: the next turn runs at
    # the same fix attempt, against the repaired tests
    fix_turns = _fix_turns(piece)
    assert [turn["result"] for turn in fix_turns] == ["objected", "ok"]
    assert [turn["fix_attempt"] for turn in fix_turns] == [1, 1]


def test_a_fix_turn_objection_recorded_on_the_objections_ledger(world):
    """The objection on the slice's objections ledger shows role, attempt,
    and the turn marked objected, and test_repairs is incremented."""
    _given_verified_objection(world, 501)

    result = run_flow(world, 501)

    assert result.returncode == 0, result.stdout + result.stderr
    piece = world.run_record(501)["slices"]["domain"]
    assert [item["kind"] for item in piece["objections"]] == ["tests_contradict"]
    objection = piece["objections"][0]
    assert objection["role"] == "builder"
    objected = _fix_turns(piece)[0]
    assert objected["result"] == "objected"
    assert objection["attempt"] == objected["attempt"]
    assert piece["test_repairs"] == 1


def test_a_partial_fix_turn_objection_is_accepted_when_other_tests_pass(world):
    """A partial objection beside the fix turn's work is accepted when every
    test it does not name already passes on that tree, and the work survives
    the repair."""
    slug = _given_reviewed_story(world, 502)
    world.scripted_test_outcome(
        TEST,
        ["fail", "pass", {FIRST: "pass", SECOND: "fail"}, "fail", "pass"],
        titles=[FIRST, SECOND],
    )
    world.agent_objects(
        slug,
        "builder",
        tests=[f"{TEST}::{SECOND}"],
        why="the fix contradicts this one test",
        files=FIX_WORK,
        changed_files=list(FIX_WORK),
    )
    # the repair corrects that one test in place, beside the work
    world.mechanic_repairs(f"{slug}-tests-1", files={TEST: "// repaired\n"}, test_files=[TEST])
    world.agent_implements(slug, "builder", files=FIX, changed_files=list(FIX))
    world.reviewer_answers(502, "merge")

    result = run_flow(world, 502)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "🧩 #502 (domain) partial objection: the other 1 acceptance test(s) pass beside it, "
        "and the builder's work stays in the worktree (src/lib/rows.ts)" in result.stdout
    )
    piece = world.run_record(502)["slices"]["domain"]
    assert piece["state"] == "succeeded" and piece["test_repairs"] == 1
    assert piece["objections"][0]["tests"] == [f"{TEST}::{SECOND}"]
    assert piece["objections"][0]["work"] == ["src/lib/rows.ts"]
    assert [turn["result"] for turn in _fix_turns(piece)] == ["objected", "ok"]


# --- objections the driver refuses during fix turns -----


def test_a_fix_turn_objection_to_a_test_that_passes_is_refused(world):
    """A fix-turn objection to a test that already passes on the fix turn's
    tree is refused and costs the fix attempt."""
    slug = _given_reviewed_story(world, 503)
    world.scripted_test_outcome(TEST, ["fail", "pass", "pass", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.agent_implements(slug, "builder", files=FIX, changed_files=list(FIX))
    world.reviewer_answers(503, "merge")

    result = run_flow(world, 503)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🩹 Repairing" not in result.stdout
    piece = world.run_record(503)["slices"]["domain"]
    assert piece["test_repairs"] == 0 and piece["objections"] == []
    # the refused objection cost the fix attempt
    fix_turns = _fix_turns(piece)
    assert [turn["fix_attempt"] for turn in fix_turns] == [1, 2]
    assert "already pass on this working tree" in fix_turns[0]["diagnostic"]


def test_a_fix_turn_objection_naming_every_test_is_refused(world):
    """A fix-turn objection naming every acceptance test beside the turn's
    work is refused: an objection beside work names a strict subset."""
    slug = _given_reviewed_story(world, 504)
    world.scripted_test_outcome(
        TEST,
        ["fail", "pass", {FIRST: "fail", SECOND: "fail"}, "pass"],
        titles=[FIRST, SECOND],
    )
    world.agent_objects(
        slug,
        "builder",
        tests=[TEST],
        why=WHY,
        files=FIX_WORK,
        changed_files=list(FIX_WORK),
    )
    world.agent_implements(slug, "builder", files=FIX, changed_files=list(FIX))
    world.reviewer_answers(504, "merge")

    result = run_flow(world, 504)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "name the tests that cannot pass" in result.stdout
    assert "🩹 Repairing" not in result.stdout
    piece = world.run_record(504)["slices"]["domain"]
    assert piece["objections"] == [] and piece["test_repairs"] == 0
    assert [turn["fix_attempt"] for turn in _fix_turns(piece)] == [1, 2]


# --- the limits -----


def test_a_third_fix_turn_objection_stops_as_tests_invalid(world):
    """A third verified objection after two repairs stops with exit 31
    (TESTS_INVALID), naming every objection."""
    slug = _given_reviewed_story(world, 505)
    world.scripted_test_outcome(TEST, ["fail", "pass", "fail"])
    world.scripted_test_outcome(REPAIRED, "fail")
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired 1\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    # a second repair goes to the role that objected
    world.agent_objects(slug, "builder", tests=[REPAIRED], why=WHY)
    world.agent_repairs(
        f"{slug}-tests-2", "builder", files={REPAIRED: "// repaired 2\n"}, test_files=[REPAIRED]
    )
    world.agent_objects(slug, "builder", tests=[REPAIRED], why="still contradictory")

    result = run_flow(world, 505)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "rejects the acceptance tests again after 2 block 1 repairs" in result.stdout
    # every objection reaches the story, in the stop's own comment
    stop = next(body for body in world.issue(505)["comments"] if body.startswith("Stopped:"))
    assert stop.count("Objection (tests_contradict)") == 3
    assert WHY in stop and "still contradictory" in stop
    piece = world.run_record(505)["slices"]["domain"]
    assert piece["state"] == "failed" and piece["test_repairs"] == 2


def test_the_new_frozen_commit_is_ancestor_of_integration_branch(world):
    """After the repair the new frozen commit is an ancestor of the
    integration branch, and the log shows a further review round."""
    _given_verified_objection(world, 506)

    result = run_flow(world, 506)

    assert result.returncode == 0, result.stdout + result.stderr
    repaired = re.search(
        r"🔒 #506 \(domain\) tests re-frozen at \w+\n⇪ Pushed story-506-domain at (\w+)",
        result.stdout,
    )
    assert repaired, result.stdout
    assert "🕵️ Review round 2/" in result.stdout
    record = world.run_record(506)
    assert record["slices"]["domain"]["state"] == "succeeded"
    ancestry = subprocess.run(
        [
            "git",
            "merge-base",
            "--is-ancestor",
            repaired.group(1),
            record["delivery"]["integration_sha"],
        ],
        cwd=world.repo,
        capture_output=True,
        text=True,
    )
    assert ancestry.returncode == 0, ancestry.stderr
