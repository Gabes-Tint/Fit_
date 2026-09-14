"""End-to-end tests for block 3's one edge back into block 1: an implementer
rejects the acceptance tests, the driver verifies the objection, block 1's
writer repairs them and the slice runs again on the repaired set.

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
WHY = "test 1 wants the apple first and tests 2-4 want the candy first"
FIRST = "a row carries its brand"
SECOND = "a row without a brand says so"
WORK = {"src/lib/rows.ts": "export const brand = true;\n"}


def _given_planned_story(
    world,
    number: int,
    outcomes: list,
    signals: dict | None = None,
    titles: list[str] | None = None,
    extra: dict[str, str] | None = None,
    writer: str = "mechanic",
    reported: list[str] | None = None,
) -> str:
    """Block 1 for a one-slice story: failing tests written, validated and
    pushed, and the slice delegated to an implementer. `signals` chooses
    which role that is, `titles` how many tests the acceptance file reports,
    `extra` writes further test files beside it, `reported` is the whole
    acceptance set block 1 freezes when that is more than the one file, and
    `writer` is the rung block 1's own ladder ended on."""
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
    if writer != "mechanic":
        # block 1's own ladder: the mechanic's budget ends with nothing
        # pushed and the rung above it writes the tests instead (#437)
        for attempt in (1, 2):
            world.mechanic_changes_without_pushing(
                slug, files={TEST: f"// mechanic attempt {attempt}\n"}, test_files=[TEST]
            )
    world.mechanic_writes(
        slug,
        files={TEST: "// failing\n", **(extra or {})},
        test_files=reported or [TEST],
        role=writer,
    )
    world.scripted_test_outcome(TEST, outcomes, titles=titles)
    world.planner_answers_delegate(
        number, [delegate_slice(number, "domain", signals or mechanic_signals())]
    )
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


# --- a repair judges the whole acceptance set ----------------------------------

# One acceptance file the objection is not about, with two tests in it that
# a repair may neither drop nor rename.
SIBLING_TESTS = 'it("a brand is shown", () => {});\nit("a missing brand says so", () => {});\n'


def test_a_repair_that_names_one_file_keeps_the_other_files_accepted_type_debt(world):
    """#422 run 4. Slice #452 froze two acceptance files, the second of them
    carrying the type errors block 1 had accepted as the story's missing API
    showing through. The repair changed one line in the first and named only
    that file; the reply's list replaced the frozen set, the second file
    stopped being an acceptance file mid-repair, and its accepted debt came
    back as "type errors outside the acceptance tests" - a rejection for the
    one thing nobody had done."""
    slug = _given_planned_story(
        world,
        470,
        ["fail", "fail", "fail", "pass"],
        extra={SIBLING: "// calls the new signature the story adds\n"},
        reported=[TEST, SIBLING],
    )
    world.scripted_test_outcome(SIBLING, ["fail", "fail", "fail", "pass"])
    # the type lane says what it says on every run: the new signature does
    # not exist yet, and it is the sibling file that calls it
    world.given_gate_outcomes(check="fail")
    world.given_type_errors_in(
        [SIBLING, SIBLING], ["TS2554", "TS2554"], "Expected 1 arguments, but got 2"
    )
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    world.mechanic_repairs(f"{slug}-tests-1", files={TEST: "// repaired\n"}, test_files=[TEST])
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    # the repair named one file and was judged on both
    assert _field(result.stdout, "Repaired") == [TEST]
    assert _field(result.stdout, "Judged") == [f"{TEST}, {SIBLING}"]
    assert "outside the acceptance tests" not in result.stdout
    assert "🔒 #470 (domain) tests re-frozen at" in result.stdout

    piece = world.run_record(470)["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_files"] == [TEST, SIBLING]
    assert piece["tests_type_debt"] == {SIBLING: 2}
    assert piece["test_repairs"] == 1


def test_a_repair_may_not_remove_tests_the_objection_did_not_name(world):
    """What the same run did next. Told its type debt was outside the
    acceptance tests, the mechanic deleted the describe block that carried
    them - five acceptance criteria - and the rest of the file then passed
    with no implementation at all. A repair may rewrite or delete what the
    objection names, and nothing else."""
    slug = _given_planned_story(
        world,
        471,
        ["fail", "fail"],
        extra={SIBLING: SIBLING_TESTS},
        reported=[TEST, SIBLING],
    )
    world.scripted_test_outcome(SIBLING, "fail")
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    # turn 1 empties the file the objection never named
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={TEST: "// repaired\n", SIBLING: "// nothing left here\n"},
        test_files=[TEST, SIBLING],
    )
    # turn 2 deletes it outright
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={TEST: "// repaired again\n"},
        test_files=[TEST],
        delete=[SIBLING],
    )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert (
        f"removed acceptance tests the objection did not name: {SIBLING}::a brand is shown, "
        f"{SIBLING}::a missing brand says so"
    ) in result.stdout
    assert f"removed acceptance tests the objection did not name: {SIBLING};" in result.stdout
    # neither turn was accepted, so the slice keeps the tests it was frozen on
    assert "tests re-frozen" not in result.stdout
    piece = world.run_record(471)["slices"]["domain"]
    assert piece["test_files"] == [TEST, SIBLING]
    assert piece["test_repairs"] == 0
    assert [turn["turn"] for turn in piece["test_repair_turns"]] == [1, 2]


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
    # the second repair names its repairer: here the objector is the
    # mechanic itself, so the mechanic keeps it
    assert (
        "🩹 Repairing #466 (domain) tests in block 1 (repair 2/2, mechanic — "
        "the mechanic's repair was objected to again)" in result.stdout
    )
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


def test_resume_remakes_the_repair_branch_a_stopped_repair_left_standing(world):
    """A repair that stops keeps its worktree and branch for audit, and the
    branch is named from `test_repairs + 1` - which only a re-freeze moves.
    So the relaunched repair asks for the name that is already taken, and
    `worktrees.create_repair_worktree` is what makes that work: it removes
    the worktree and deletes the branch before creating either."""
    slug = _given_planned_story(world, 476, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    # the repair turn dies before it can reply, so its worktree stands
    world.mechanic_fails(f"{slug}-tests-1", "the repair turn died")

    stopped = run_flow(world, 476)

    assert stopped.returncode == 21, stopped.stdout + stopped.stderr
    repair_worktree = world.slice_worktree_path(f"{slug}-tests-1")
    assert repair_worktree.exists()
    assert _local_branches(world).count(f"{slug}-tests-1") == 1
    # and what the dead repair left in it must not reach the repaired tests
    (repair_worktree / "src" / "lib").mkdir(parents=True, exist_ok=True)
    (repair_worktree / "src" / "lib" / "leftover.spec.ts").write_text("// half a repair\n")

    _repair(world, slug)
    world.agent_implements(
        slug,
        "mechanic",
        files={"src/lib/rows.ts": "export const brand = true;\n"},
        changed_files=["src/lib/rows.ts"],
    )

    result = run_flow(world, 476, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🩹 Repairing #476 (domain) tests in block 1 (repair 1/2)" in result.stdout
    piece = world.run_record(476)["slices"]["domain"]
    assert piece["state"] == "succeeded" and piece["test_files"] == [REPAIRED]
    # the repair landed from the base, not from what the dead one left
    assert not (world.slice_worktree_path(slug) / "src/lib/leftover.spec.ts").exists()


def test_resume_after_a_repair_block_1_could_not_make_stops_instead_of_repeating_it(world):
    """A repair refused on both of its turns spends the budget without
    moving `test_repairs`, so the branch name and the repair number are the
    same ones again. Relaunching it could only reach the same refusal: the
    resume stops and says who repairs the tests now."""
    slug = _given_planned_story(world, 477, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
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

    stopped = run_flow(world, 477)

    assert stopped.returncode == 31, stopped.stdout + stopped.stderr
    assert world.run_record(477)["slices"]["domain"]["test_repair_spent"] == 1

    # a repair is scripted for the resume; the driver must not reach it
    _repair(world, slug)

    result = run_flow(world, 477, "--resume")

    assert result.returncode == 30, result.stdout + result.stderr
    assert (
        "story-477-domain spent both of block 1's turns on repair 1 and its acceptance "
        "tests are still rejected" in result.stdout
    )
    assert "repair them by hand; audit it, then `go.py 477 --reset`" in result.stdout
    assert "🩹 Repairing #477" not in result.stdout
    piece = world.run_record(477)["slices"]["domain"]
    assert piece["state"] == "tests_rejected" and piece["test_repairs"] == 0
    assert len(piece["test_repair_turns"]) == 2


# --- the second repair goes to the role that objected --------------------------


def _given_two_objections(world, number: int) -> str:
    """A builder slice whose first repair is objected to as well: the
    mechanic repairs once, the builder repairs the second time, and the
    repaired tests then pass."""
    slug = _given_planned_story(world, number, ["fail", "fail"], signals=builder_signals())
    world.scripted_test_outcome(REPAIRED, ["fail", "fail", "fail", "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={REPAIRED: "// repaired once\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.agent_objects(slug, "builder", tests=[REPAIRED], why="the repair moved the same problem")
    world.agent_repairs(
        f"{slug}-tests-2",
        "builder",
        files={REPAIRED: "// repaired by the builder\n"},
        test_files=[REPAIRED],
    )
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(number, "merge")
    return slug


def test_the_second_repair_is_talked_to_the_role_that_objected(world):
    slug = _given_two_objections(world, 471)

    result = run_flow(world, 471)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🩹 Repairing #471 (domain) tests in block 1 (repair 1/2)" in result.stdout
    assert (
        "🩹 Repairing #471 (domain) tests in block 1 (repair 2/2, builder — "
        "the mechanic's repair was objected to again)" in result.stdout
    )
    assert "🔧 Builder #471 (domain) test repair turn 1/2" in result.stdout
    # the mechanic wrote the tests and made the first repair; the second is
    # the builder's, on its own repair team, and no mechanic was asked
    assert len(_talks(world, "mechanic", f"{slug}-tests-1")) == 1
    assert len(_talks(world, "builder", f"{slug}-tests-2")) == 1
    assert _talks(world, "mechanic", f"{slug}-tests-2") == []
    # and it is briefed on everything that came before it
    prompt = _talks(world, "builder", f"{slug}-tests-2")[0]["prompt"]
    assert "This is repair 2 of 2" in prompt
    assert "Earlier objections:" in prompt and WHY in prompt
    assert "What the repairs replied:" in prompt


def test_the_ledger_records_which_role_made_each_repair(world):
    _given_two_objections(world, 472)

    result = run_flow(world, 472)

    assert result.returncode == 0, result.stdout + result.stderr
    piece = world.run_record(472)["slices"]["domain"]
    assert [turn["role"] for turn in piece["test_repair_turns"]] == ["mechanic", "builder"]
    assert [turn["repair"] for turn in piece["test_repair_turns"]] == [1, 2]
    assert piece["test_repairs"] == 2 and piece["state"] == "succeeded"


# --- an objection beside finished work -----------------------------------------


def _given_partial_story(world, number: int, outcomes: list) -> str:
    """One acceptance file with two tests, and a builder that implements one
    of them and objects to the other."""
    return _given_planned_story(
        world, number, outcomes, signals=builder_signals(), titles=[FIRST, SECOND]
    )


def test_a_partial_objection_beside_finished_work_is_accepted_when_the_rest_passes(world):
    slug = _given_partial_story(
        world, 473, ["fail", {FIRST: "pass", SECOND: "fail"}, "fail", "pass"]
    )
    world.agent_objects(
        slug,
        "builder",
        tests=[f"{TEST}::{SECOND}"],
        why="no row can say it has no brand while the fixture gives every row one",
        files=WORK,
        changed_files=list(WORK),
    )
    # the repair corrects that one test in place, beside the work
    world.mechanic_repairs(f"{slug}-tests-1", files={TEST: "// repaired\n"}, test_files=[TEST])
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(473, "merge")

    result = run_flow(world, 473)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "🧩 #473 (domain) partial objection: the other 1 acceptance test(s) pass beside it, "
        "and the builder's work stays in the worktree (src/lib/rows.ts)" in result.stdout
    )
    piece = world.run_record(473)["slices"]["domain"]
    assert piece["state"] == "succeeded" and piece["test_repairs"] == 1
    assert piece["objections"][0]["tests"] == [f"{TEST}::{SECOND}"]
    assert piece["objections"][0]["work"] == ["src/lib/rows.ts"]
    # the repairer is told the work is there and must be repaired around
    repair_prompt = _talks(world, "mechanic", f"{slug}-tests-1")[0]["prompt"]
    assert "left its work in the slice's worktree (src/lib/rows.ts)" in repair_prompt
    assert (
        f'{TEST} "{SECOND}" → failed an expectation: AssertionError: expected undefined to be 42'
        in repair_prompt
    )


def test_the_implementers_work_survives_the_repair_and_the_next_brief_says_so(world):
    slug = _given_partial_story(
        world, 474, ["fail", {FIRST: "pass", SECOND: "fail"}, "fail", "pass"]
    )
    world.agent_objects(
        slug,
        "builder",
        tests=[f"{TEST}::{SECOND}"],
        why="no row can say it has no brand while the fixture gives every row one",
        files=WORK,
        changed_files=list(WORK),
    )
    world.mechanic_repairs(f"{slug}-tests-1", files={TEST: "// repaired\n"}, test_files=[TEST])
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(474, "merge")

    result = run_flow(world, 474)

    assert result.returncode == 0, result.stdout + result.stderr
    brief = _talks(world, "builder", slug)[1]["prompt"]
    assert "Your own work was kept exactly as you left it (src/lib/rows.ts)" in brief
    assert f"the repair changed only {TEST}::{SECOND}" in brief
    assert "every other acceptance test of this slice passed on your tree" in brief


def test_a_partial_objection_is_refused_when_a_test_it_did_not_name_still_fails(world):
    slug = _given_partial_story(world, 475, ["fail", {FIRST: "fail", SECOND: "fail"}, "pass"])
    world.agent_objects(
        slug,
        "builder",
        tests=[f"{TEST}::{SECOND}"],
        why="no row can say it has no brand while the fixture gives every row one",
        files=WORK,
        changed_files=list(WORK),
    )
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(475, "merge")

    result = run_flow(world, 475)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        f"{TEST}::{FIRST} does not pass on your working tree, and an objection beside "
        "work is only accepted when every test you did not name already passes" in result.stdout
    )
    assert "🩹 Repairing" not in result.stdout
    piece = world.run_record(475)["slices"]["domain"]
    assert piece["objections"] == [] and piece["test_repairs"] == 0
    # the refused objection cost the attempt, as any unverifiable one does
    assert [turn["attempt"] for turn in piece["turns"]] == [1, 2]


def test_an_objection_beside_work_that_names_every_test_is_refused(world):
    slug = _given_partial_story(world, 476, ["fail", {FIRST: "fail", SECOND: "fail"}, "pass"])
    world.agent_objects(
        slug, "builder", tests=[TEST], why=WHY, files=WORK, changed_files=list(WORK)
    )
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(476, "merge")

    result = run_flow(world, 476)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "this objection names every acceptance test of the slice, and your tree carries "
        "work (src/lib/rows.ts): name the tests that cannot pass" in result.stdout
    )
    assert "🩹 Repairing" not in result.stdout
    assert world.run_record(476)["slices"]["domain"]["objections"] == []


# --- the objection is verified test by test ------------------------------------


def test_a_whole_file_objection_is_refused_when_every_test_in_it_passes(world):
    slug = _given_partial_story(world, 477, ["fail", {FIRST: "pass", SECOND: "pass"}, "pass"])
    world.agent_objects(slug, "builder", tests=[TEST], why=WHY)
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(477, "merge")

    result = run_flow(world, 477)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "already pass on this working tree" in result.stdout
    # per test, not per file: the refusal says what the runner said of each
    assert f'"{FIRST}" → passed' in result.stdout
    assert f'"{SECOND}" → passed' in result.stdout
    assert "🩹 Repairing" not in result.stdout


def test_an_objection_naming_a_test_that_passes_is_refused_naming_it(world):
    slug = _given_partial_story(world, 478, ["fail", {FIRST: "pass", SECOND: "fail"}, "pass"])
    world.agent_objects(slug, "builder", tests=[f"{TEST}::{FIRST}", f"{TEST}::{SECOND}"], why=WHY)
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(478, "merge")

    result = run_flow(world, 478)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        f"{TEST}::{FIRST} already passes on this working tree, so there is nothing for "
        "block 1 to repair there" in result.stdout
    )
    assert "🩹 Repairing" not in result.stdout
    assert world.run_record(478)["slices"]["domain"]["objections"] == []


def test_the_repair_brief_says_how_each_named_test_failed(world):
    slug = _given_partial_story(
        world, 479, ["fail", {FIRST: "pass", SECOND: "fail_defect"}, "fail", "pass"]
    )
    world.agent_objects(
        slug,
        "builder",
        tests=[f"{TEST}::{SECOND}"],
        why="the empty state is unreachable while the fixture seeds a row",
    )
    world.mechanic_repairs(f"{slug}-tests-1", files={TEST: "// repaired\n"}, test_files=[TEST])
    world.agent_implements(slug, "builder", files=WORK, changed_files=list(WORK))
    world.reviewer_answers(479, "merge")

    result = run_flow(world, 479)

    assert result.returncode == 0, result.stdout + result.stderr
    repair_prompt = _talks(world, "mechanic", f"{slug}-tests-1")[0]["prompt"]
    assert "How each of them failed on the implementer's tree:" in repair_prompt
    # a test that throws is not the same defect as one whose assertion bit,
    # and the repairer is told which this was
    assert (
        f'{TEST} "{SECOND}" → threw: TypeError: locator.boundingBox is not a function'
        in repair_prompt
    )


# --- the repair brief carries the repository's conventions ---------------------


def test_the_repair_brief_lists_the_sibling_tests_of_the_same_kind(world):
    slug = _given_planned_story(
        world,
        480,
        ["fail", "fail"],
        extra={SIBLING: "describe('brand rows', () => {});\n"},
    )
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    _repair(world, slug)
    world.agent_implements(slug, "mechanic", files=WORK, changed_files=list(WORK))

    result = run_flow(world, 480)

    assert result.returncode == 0, result.stdout + result.stderr
    repair_prompt = _talks(world, "mechanic", f"{slug}-tests-1")[0]["prompt"]
    assert "These are the repository's own tests of this kind, nearest first" in repair_prompt
    assert f'- `{SIBLING}` — first test: "brand rows"' in repair_prompt
    # the file under repair is not its own sibling
    assert f"- `{TEST}`" not in repair_prompt


def test_resume_relaunches_the_repair_with_the_role_block_1_ended_on(world):
    """Block 1 escalates its own writer when a rung runs out (#437), and the
    slice retains which role finally wrote the tests. The repair an
    objection asks for is that role's work - it is the one that knows what
    the tests meant - so a run stopped inside the repair relaunches the
    builder, not the mechanic whose attempts were spent before a line was
    ever pushed."""
    slug = _given_planned_story(world, 471, ["fail", "fail"], writer="builder")
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    # no repair turn is scripted, so the first run dies at block 1's launch
    stopped = run_flow(world, 471)

    assert stopped.returncode == 21, stopped.stdout + stopped.stderr
    assert "⬆️  Block 1 #471: mechanic stopped early" in stopped.stdout
    assert "the builder takes over the tests" in stopped.stdout
    piece = world.run_record(471)["slices"]["domain"]
    assert piece["tests_role"] == "builder" and piece["state"] == "tests_rejected"
    assert "no scripted turn left for story-471-domain-tests-1/builder" in stopped.stdout

    world.agent_repairs(
        f"{slug}-tests-1",
        "builder",
        files={REPAIRED: "// repaired\n"},
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.agent_implements(slug, "mechanic", files=WORK, changed_files=sorted(WORK))

    result = run_flow(world, 471, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "relaunching block 1's repair (builder)" in result.stdout
    # the dead run's launch and the resumed one, both the builder's, and
    # the mechanic was never asked to repair tests it did not write
    assert len(_talks(world, "builder", f"{slug}-tests-1")) == 2
    assert _talks(world, "mechanic", f"{slug}-tests-1") == []
    assert world.run_record(471)["slices"]["domain"]["test_files"] == [REPAIRED]


# --- a repair may put shared setup in a tests/ helper (issue #337) --------------


def test_a_block_1_repair_may_extract_shared_setup_into_a_tests_helper(world):
    """The path #337 run 5 actually took: the objection came back, the
    repair answered it by moving the setup the acceptance files repeat into
    `tests/e2e-support.ts`, and the driver refused the turn as a non-test
    file. The repair is accepted now, and the helper stays out of the
    acceptance set the implementer is judged against."""
    support = "tests/e2e-support.ts"
    slug = _given_planned_story(world, 481, ["fail", "fail"])
    world.scripted_test_outcome(REPAIRED, ["fail", "pass"])
    world.agent_objects(slug, "mechanic", tests=[TEST], why=WHY)
    world.mechanic_repairs(
        f"{slug}-tests-1",
        files={
            REPAIRED: "// repaired: the setup now comes from the helper\n",
            support: "// setup\n",
        },
        test_files=[REPAIRED],
        delete=[TEST],
    )
    world.agent_implements(slug, "mechanic", files=WORK, changed_files=list(WORK))

    result = run_flow(world, 481)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "non-test file changed" not in result.stdout
    assert "🔒 #481 (domain) tests re-frozen at" in result.stdout
    piece = world.run_record(481)["slices"]["domain"]
    assert piece["state"] == "succeeded"
    assert piece["test_files"] == [REPAIRED]
