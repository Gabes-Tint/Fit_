"""End-to-end tests for block 3's one edge back into block 1: an implementer
rejects the acceptance tests, the driver verifies the objection, block 1's
writer repairs them and the slice runs again on the repaired set.

Black-box like the other suites: every assertion is on go.py's exit code,
its log, the retained record and the fake world.
"""

from conftest import (
    delegate_slice,
    mechanic_signals,
    run_flow,
)

TEST = "src/lib/rows.spec.ts"
REPAIRED = "src/lib/rows-repaired.spec.ts"
WHY = "test 1 wants the apple first and tests 2-4 want the candy first"


def _given_planned_story(world, number: int, outcomes: list[str]) -> str:
    """Block 1 for a one-slice story: failing tests written, validated and
    pushed, and the slice delegated to a mechanic."""
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
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", mechanic_signals())])
    return slug


def _repair(world, slug: str, repair: int = 1) -> str:
    """Block 1's repair turn, in the driver's own repair worktree: the old
    acceptance file is dropped and a repaired one takes its place."""
    repair_slug = f"{slug}-tests-{repair}"
    world.mechanic_repairs(
        repair_slug,
        files={REPAIRED: "// repaired\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    return repair_slug


def _talks(world, role: str, team: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", role]
        and call["argv"][call["argv"].index("--team") + 1] == team
    ]


# --- a verified objection goes to block 1 --------------------------------------


def test_a_verified_objection_goes_to_block_1_and_the_repaired_tests_let_the_slice_pass(world):
    # block 1 writes them failing, the objection check finds them still
    # failing, and the old file is never run again
    slug = _given_planned_story(world, 460, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    _repair(world, slug)
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 460)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"🙅 #460 (domain) mechanic rejects the tests: tests_contradict — {WHY}" in result.stdout
    assert "🩹 Repairing #460 (domain) tests in block 1 (repair 1/2)" in result.stdout
    assert "🔒 #460 (domain) tests re-frozen at" in result.stdout
    assert "🔒 #460 (domain) frozen at" in result.stdout

    state = world.run_record(460)
    piece = state["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_files"] == [REPAIRED]
    assert piece["test_repairs"] == 1
    assert [item["kind"] for item in piece["objections"]] == ["tests_contradict"]
    # the repaired commit is the immutable one, and the driver's merge of it
    # is the base every later check compares against
    assert piece["tests_sha"] != piece["failing_sha"]
    # the objecting turn is settled as such, and it cost no attempt: the
    # implementation turn that froze the slice is attempt 1 again
    assert [turn["result"] for turn in piece["turns"]] == ["objected", "ok"]
    assert [turn["attempt"] for turn in piece["turns"]] == [1, 1]
    assert [turn["kind"] for turn in piece["test_repair_turns"]] == ["test_repair"]
    # block 1's repair ran on its own team, and its worktree is gone again
    assert len(_talks(world, "mechanic", f"{slug}-tests-1")) == 1
    assert not world.slice_worktree_path(f"{slug}-tests-1").exists()
    assert any("Acceptance tests repaired" in body for body in world.issue(460)["comments"])


def test_the_next_turn_after_a_repair_is_briefed_on_the_repaired_tests(world):
    slug = _given_planned_story(world, 461, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    _repair(world, slug)
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 461)

    assert result.returncode == 0, result.stdout + result.stderr
    prompts = [call["prompt"] for call in _talks(world, "mechanic", slug)]
    # block 1's turn, the objecting turn, then the turn briefed on the repair
    assert len(prompts) == 3
    assert "The acceptance tests changed since your last turn" in prompts[2]
    assert REPAIRED in prompts[2] and TEST not in prompts[2]
    # and the repair turn carried the objection and its proposed fix
    repair_prompt = _talks(world, "mechanic", f"{slug}-tests-1")[0]["prompt"]
    assert "rejected these acceptance tests" in repair_prompt
    assert WHY in repair_prompt
    assert "drop the first test" in repair_prompt


# --- objections the driver refuses ---------------------------------------------


def test_an_objection_to_a_test_that_already_passes_is_refused_and_costs_the_attempt(world):
    # block 1 sees it fail; by the objection check it passes
    slug = _given_planned_story(world, 462, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 462)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "already pass on this working tree" in result.stdout
    assert "🩹 Repairing" not in result.stdout
    assert "🔁 Mechanic #462 (domain) correcting after attempt 1" in result.stdout
    piece = world.run_record(462)["slices"]["domain"]
    assert piece["test_repairs"] == 0 and piece["objections"] == []
    # the refused objection cost the attempt: the slice froze on attempt 2
    assert [turn["attempt"] for turn in piece["turns"]] == [1, 2]


def test_an_objection_naming_a_file_that_is_not_an_acceptance_test_is_refused(world):
    slug = _given_planned_story(world, 463, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=["src/lib/something-else.spec.ts"], why=WHY)
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 463)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "src/lib/something-else.spec.ts is not a retained acceptance test" in result.stdout
    assert "🩹 Repairing" not in result.stdout
    piece = world.run_record(463)["slices"]["domain"]
    assert piece["test_repairs"] == 0 and piece["objections"] == []


def test_a_malformed_objection_is_refused_with_the_condition_it_failed(world):
    slug = _given_planned_story(world, 464, ["fail", "pass"])
    world.agent_objects(
        slug,
        "mechanic",
        tests=[TEST],
        objection={"kind": "no_such_kind", "tests": [TEST], "why": WHY},
    )
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 464)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "objection kind must be one of tests_contradict" in result.stdout
    assert world.run_record(464)["slices"]["domain"]["objections"] == []


def test_an_objection_left_beside_work_outside_the_slice_is_refused(world):
    slug = _given_planned_story(world, 465, ["fail", "pass"])
    world.agent_objects(
        slug,
        "mechanic",
        tests=[TEST],
        why=WHY,
        files={"src/routes/rows/+page.svelte": "<p>out of layer</p>\n"},
    )
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
        delete=["src/routes/rows/+page.svelte"],
    )

    result = run_flow(world, 465)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "domain slice changed a UI file: src/routes/rows/+page.svelte" in result.stdout
    assert "put those paths back before objecting" in result.stdout
    assert "🩹 Repairing" not in result.stdout


# --- the limits ----------------------------------------------------------------


def test_a_second_objection_after_two_repairs_stops_as_tests_invalid(world):
    slug = _given_planned_story(world, 466, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "fail", "fail", "fail"])
    for repair in (1, 2):
        world.agent_objects(slug, "mechanic", tests=[TEST if repair == 1 else REPAIRED], why=WHY)
        world.mechanic_repairs(
            f"{slug}-tests-{repair}",
            files={REPAIRED: f"// repaired {repair}\n"},
            test_files=[REPAIRED],
            delete=[TEST] if repair == 1 else None,
        )
    world.agent_objects(slug, "mechanic", tests=[REPAIRED], why="still contradictory")

    result = run_flow(world, 466)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "🩹 Repairing #466 (domain) tests in block 1 (repair 2/2)" in result.stdout
    assert "rejects the acceptance tests again after 2 block 1 repairs" in result.stdout
    # both verified objections reach the story, in the stop's own comment
    stop = next(body for body in world.issue(466)["comments"] if body.startswith("Stopped:"))
    assert stop.count("Objection (tests_contradict)") == 3
    assert WHY in stop and "still contradictory" in stop
    assert "blocked" in world.issue(466)["labels"]
    piece = world.run_record(466)["slices"]["domain"]
    assert piece["state"] == "failed" and piece["test_repairs"] == 2


def test_a_block_1_repair_that_changes_a_non_test_file_is_sent_back_to_the_mechanic(world):
    slug = _given_planned_story(world, 467, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    # the first repair turn drags a production file along; the second is clean
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired\n", "src/lib/rows.ts": "export const sneak = true;\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired again\n"},
        test_files=[REPAIRED],
        delete=["src/lib/rows.ts"],
    )
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 467)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "non-test file changed on story-467-domain-tests-1: src/lib/rows.ts" in result.stdout
    assert "🔁 #467 (domain) test repair retrying" in result.stdout
    assert "🔒 #467 (domain) tests re-frozen at" in result.stdout
    piece = world.run_record(467)["slices"]["domain"]
    assert [turn["result"] for turn in piece["test_repair_turns"]] == ["ok", "ok"]


def test_a_repair_block_1_cannot_make_stops_as_tests_invalid(world):
    slug = _given_planned_story(world, 468, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    # both repair turns drag a production file along, so block 1 rejects both
    for turn in (1, 2):
        world.mechanic_repairs(
            f"{slug}-tests-1",
            files={
                REPAIRED: f"// repaired {turn}\n",
                "src/lib/rows.ts": f"export const sneak = {turn};\n",
            },
            test_files=[REPAIRED],
            delete=[TEST] if turn == 1 else None,
        )

    result = run_flow(world, 468)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "block 1 could not repair the acceptance tests the mechanic rejected" in result.stdout
    assert "blocked" in world.issue(468)["labels"]
    piece = world.run_record(468)["slices"]["domain"]
    # still rejected and still unrepaired: that is what the slice is, and a
    # `--resume` relaunches the repair rather than the implementer
    assert piece["state"] == "tests_rejected" and piece["test_repairs"] == 0
    # the failed repair's worktree is kept for audit
    assert world.slice_worktree_path(f"{slug}-tests-1").exists()


# --- resume --------------------------------------------------------------------


def test_resume_relaunches_the_repair_of_a_slice_whose_tests_were_rejected(world):
    slug = _given_planned_story(world, 469, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    # no repair turn is scripted, so the first run dies at block 1's launch
    stopped = run_flow(world, 469)

    assert stopped.returncode == 21, stopped.stdout + stopped.stderr
    assert "🩹 Repairing #469 (domain) tests in block 1 (repair 1/2)" in stopped.stdout
    piece = world.run_record(469)["slices"]["domain"]
    assert piece["state"] == "tests_rejected" and piece["test_repairs"] == 0
    assert [turn["result"] for turn in piece["test_repair_turns"]] == ["failed"]

    _repair(world, slug)
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 469, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "♻️  #469 (domain) rejected the acceptance tests" in result.stdout
    assert "relaunching block 1's repair" in result.stdout
    assert "🩹 Repairing #469 (domain) tests in block 1 (repair 1/2)" in result.stdout
    piece = world.run_record(469)["slices"]["domain"]
    assert piece["state"] == "succeeded" and piece["test_files"] == [REPAIRED]
    # the objecting turn was not re-judged: no second objection was recorded
    assert len(piece["objections"]) == 1


def test_resume_voids_a_repair_turn_that_died_and_relaunches_it(world):
    slug = _given_planned_story(world, 470, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)

    stopped = run_flow(world, 470)

    assert stopped.returncode == 21, stopped.stdout + stopped.stderr
    assert world.run_record(470)["slices"]["domain"]["state"] == "tests_rejected"

    # a driver killed while the repair turn ran leaves the entry running,
    # which no scripted failure can reach
    def kill_the_turn(state):
        entry = state["slices"]["domain"]["test_repair_turns"][-1]
        entry["status"] = "running"
        entry["result"] = ""
        entry["why"] = ""

    world.rewrite_run_record(470, kill_the_turn)
    _repair(world, slug)
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 470, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "test repair 1 turn 1 voided" in result.stdout
    assert "🩹 Repairing #470 (domain) tests in block 1 (repair 1/2)" in result.stdout
    piece = world.run_record(470)["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert [turn["result"] for turn in piece["test_repair_turns"]] == ["void", "ok"]
