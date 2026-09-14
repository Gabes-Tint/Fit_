"""End-to-end tests for `go.py <n> --resume` of a block 4 fix request that a
fix turn's verified objection sent to block 1: stopped while the repair was
still owed, or after the repaired tests were re-frozen but before the fix
request relaunched its attempt.

Black-box like the other suites: a first run stops somewhere real, then a
second invocation continues it, and every assertion is on exit codes, logs,
the retained record and the fake-world state.
"""

from conftest import (
    builder_signals,
    delegate_slice,
    run_flow,
)

TEST = "src/lib/rows.spec.ts"
REPAIRED = "src/lib/rows-repaired.spec.ts"
WORK = {"src/lib/rows.ts": "export const brand = true;\n"}
FIX = {"src/lib/rows.ts": 'export const brand = "adjusted";\n'}
WHY = "the acceptance tests contradict the fix's commit"


def _given_objecting_fix_turn(world, number: int) -> str:
    """Blocks 1-3, a review that asks for a fix, and a first fix turn that
    objects to the whole acceptance file while it still fails on its tree."""
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
    world.scripted_test_outcome(TEST, ["fail", "pass", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    return slug


def _the_repair_and_the_rest(world, number: int, slug: str) -> None:
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )


def _fix_turns(world, number: int) -> list[dict]:
    return [
        turn
        for turn in world.run_record(number)["slices"]["domain"]["turns"]
        if turn["kind"] == "review_fix"
    ]


def test_resume_relaunches_the_repair_a_fix_turn_objection_left_owed_and_finishes_the_fix(world):
    """The repair turn died, so the slice is parked in `tests_rejected` with
    its last implementation turn a fix turn. The resume continues at block 4,
    relaunches block 1's repair, and the fix request goes on at the attempt
    that objected."""
    slug = _given_objecting_fix_turn(world, 640)
    world.agent_fails(f"{slug}-tests-1", "mechanic", "provider unavailable")
    first = run_flow(world, 640)
    assert first.returncode == 21, first.stdout + first.stderr
    piece = world.run_record(640)["slices"]["domain"]
    assert piece["state"] == "tests_rejected"
    assert piece["turns"][-1]["result"] == "objected"

    _the_repair_and_the_rest(world, 640, slug)
    world.agent_implements(slug, "builder", files=FIX, changed_files=list(FIX))
    world.reviewer_answers(640, "merge")

    result = run_flow(world, 640, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "A block 4 fix was interrupted: continuing at block 4" in result.stdout
    assert "🩹 Repairing #640 (domain) tests in block 1 (repair 1/2)" in result.stdout
    assert "🔧 Builder #640 (domain) review fix attempt 1/3" in result.stdout
    assert world.pull(500)["state"] == "MERGED"
    piece = world.run_record(640)["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_files"] == [REPAIRED]
    assert piece["test_repairs"] == 1
    fix_turns = _fix_turns(world, 640)
    assert [turn["result"] for turn in fix_turns] == ["objected", "ok"]
    assert [turn["fix_attempt"] for turn in fix_turns] == [1, 1]


def test_resume_relaunches_the_objected_fix_attempt_after_the_tests_were_re_frozen(world):
    """The repair landed and was pushed, then the driver stopped before the
    fix request relaunched its attempt - here on the repair's own issue
    comment. The merge moved the tree past the digest the objecting turn
    left, and that is not a conflict: the objection is verified and repaired,
    so the same fix attempt relaunches against the repaired tests."""
    slug = _given_objecting_fix_turn(world, 641)
    _the_repair_and_the_rest(world, 641, slug)
    world.gh_fails_on_comment_body("Acceptance tests repaired for #641")
    first = run_flow(world, 641)
    assert first.returncode != 0, first.stdout + first.stderr
    assert "🔒 #641 (domain) tests re-frozen at" in first.stdout
    piece = world.run_record(641)["slices"]["domain"]
    assert piece["state"] == "fixing"
    assert piece["turns"][-1]["result"] == "objected"
    assert piece["test_repairs"] == 1

    world._load()
    world.world["gh_fail_on_body"] = []
    world._save()
    world.agent_implements(slug, "builder", files=FIX, changed_files=list(FIX))
    world.reviewer_answers(641, "merge")

    result = run_flow(world, 641, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "fix attempt 1 objected and its tests were repaired" in result.stdout
    assert "worktree changed since" not in result.stdout
    assert "🩹 Repairing" not in result.stdout
    assert world.pull(500)["state"] == "MERGED"
    piece = world.run_record(641)["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_repairs"] == 1
    fix_turns = _fix_turns(world, 641)
    assert [turn["result"] for turn in fix_turns] == ["objected", "ok"]
    assert [turn["fix_attempt"] for turn in fix_turns] == [1, 1]
