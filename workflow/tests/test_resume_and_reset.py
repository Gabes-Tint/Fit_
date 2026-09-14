"""End-to-end tests for `go.py <n> --resume` and `go.py <n> --reset`.
Black-box like the other suites: a first run stops somewhere real, then a
second invocation continues or undoes it, and every assertion is on exit
codes, logs, the retained record and the fake-world state.
"""

import fcntl
import subprocess
import time

from conftest import (
    builder_signals,
    delegate_slice,
    mechanic_signals,
    run_flow,
)

from fitflow import agents

IMPLEMENTATION = {"src/lib/delegate.ts": "export const delegate = true;\n"}
CHANGED = ["src/lib/delegate.ts"]


def _given_planned_story(world, number: int, layer: str = "domain") -> str:
    """Script the whole of block 1: one slice, failing tests written,
    validated and pushed. Returns the acceptance test file."""
    world.given_story(number, title="Resumed story", labels=["story"])
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
                "title": "Resumed work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": "vitest",
            }
        ],
    )
    test_file = "src/lib/delegate.spec.ts"
    world.mechanic_writes(
        f"story-{number}-{layer}", files={test_file: "// failing\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    return test_file


def _given_planned_split(world, number: int) -> None:
    world.given_story(number, title="Split resume", labels=["story"])
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


def _delegate_mechanic(world, number: int, layer: str = "domain") -> None:
    world.planner_answers_delegate(number, [delegate_slice(number, layer, mechanic_signals())])


def _talks(world, role: str, team: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", role]
        and call["argv"][call["argv"].index("--team") + 1] == team
    ]


def _stopped_by_a_gate_crash(
    world, number: int, files: dict[str, str] | None = None, changed: list[str] | None = None
) -> None:
    """A first run whose only implementation turn was fine, and whose
    validation then died on a tool failure - a stop the driver, not the
    agent, is responsible for."""
    _given_planned_story(world, number)
    _delegate_mechanic(world, number)
    world.agent_implements(
        f"story-{number}-domain",
        "mechanic",
        files=files or IMPLEMENTATION,
        changed_files=changed or CHANGED,
    )
    world.given_gate_outcomes(**{"verify:changed": "tool_error"})
    result = run_flow(world, number)
    assert result.returncode == 26, result.stdout + result.stderr
    assert "blocked" in world.issue(number)["labels"]


def _stopped_by_an_agent_failure(world, number: int, files: dict | None = None) -> None:
    _given_planned_story(world, number)
    _delegate_mechanic(world, number)
    world.agent_fails(f"story-{number}-domain", "mechanic", "provider unavailable", files=files)
    result = run_flow(world, number)
    assert result.returncode == 21, result.stdout + result.stderr


# --- resume: block 3 -----------------------------------------------------------


def test_resume_re_validates_a_completed_turn_without_a_new_agent_call(world):
    _stopped_by_a_gate_crash(world, 600)
    world.given_gate_outcomes(**{"verify:changed": "pass"})

    result = run_flow(world, 600, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "re-validating mechanic attempt 1 from its retained reply" in result.stdout
    assert "🔒 #600 (domain) frozen at" in result.stdout
    # block 1's test-writing turn and the one implementation turn: nothing new
    assert len(_talks(world, "mechanic", "story-600-domain")) == 2
    assert "blocked" not in world.issue(600)["labels"]
    assert "in-progress" not in world.issue(600)["labels"]
    state = world.run_record(600)
    assert state["terminal"] == "SHIPPED"
    assert state["slices"]["domain"]["attempts"] == 1


def test_resume_relaunches_a_turn_that_failed_before_replying(world):
    _stopped_by_an_agent_failure(world, 601)
    world.agent_implements(
        "story-601-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )

    result = run_flow(world, 601, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "attempt 1 voided" in result.stdout
    assert "relaunching mechanic attempt 1" in result.stdout
    turns = world.run_record(601)["slices"]["domain"]["turns"]
    assert [turn["attempt"] for turn in turns] == [1, 1]
    assert turns[0]["result"] == "void"
    assert turns[0]["why"].startswith("voided on resume:")
    assert turns[1]["result"] == "ok"
    assert world.run_record(601)["slices"]["domain"]["attempts"] == 1
    assert len(_talks(world, "mechanic", "story-601-domain")) == 3


def test_resume_voids_a_turn_the_driver_never_saw_end(world):
    _stopped_by_an_agent_failure(world, 602)

    def killed_mid_turn(state):
        piece = state["slices"]["domain"]
        piece["state"] = "running"
        piece["turns"][-1].update(status="running", result="", why="")
        state["terminal"] = ""

    world.rewrite_run_record(602, killed_mid_turn)
    world.agent_implements(
        "story-602-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )

    result = run_flow(world, 602, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "the driver stopped while the turn was running" in result.stdout
    assert world.run_record(602)["terminal"] == "SHIPPED"


def _await_the_fake_turn(team: str, role: str) -> None:
    """Hold until the fake turn is in the process table the driver reads.
    `Popen` returns when the fork happens, not when bash has exec'd itself
    into the renamed `sleep`; a resume started inside that window scans a
    table the turn is not in yet and relaunches beside it, which is the
    opposite of what this test is about."""
    deadline = time.monotonic() + 5
    while not agents.turn_in_flight(team, role):
        if time.monotonic() > deadline:
            raise AssertionError(f"the fake {role} turn for {team} never reached the process table")
        time.sleep(0.01)


def test_resume_never_relaunches_beside_a_turn_still_running(world):
    _stopped_by_an_agent_failure(world, 603)

    def killed_mid_turn(state):
        state["slices"]["domain"]["state"] = "running"
        state["slices"]["domain"]["turns"][-1].update(status="running", result="", why="")

    world.rewrite_run_record(603, killed_mid_turn)
    orphan = subprocess.Popen(
        ["bash", "-c", 'exec -a "aarmy talk mechanic --team story-603-domain" sleep 60']
    )
    try:
        _await_the_fake_turn("story-603-domain", "mechanic")
        result = run_flow(world, 603, "--resume")
        outlived_the_resume = orphan.poll() is None
    finally:
        orphan.kill()
        orphan.wait()

    assert outlived_the_resume, "the fake turn ended before the driver looked for it"
    assert result.returncode == 29, result.stdout + result.stderr
    assert "a mechanic turn is still running on this machine" in result.stdout
    assert len(_talks(world, "mechanic", "story-603-domain")) == 2  # nothing relaunched


def test_a_run_stopped_with_an_application_script_in_its_tree_resumes_and_freezes(world):
    """#337's own tree: the slice's diff carries `scripts/eval/`, the search
    evaluation harness the story was about. That is application tooling, not
    a gate, so re-validating the retained turn passes on the same bytes
    instead of stopping on it."""
    _stopped_by_a_gate_crash(
        world,
        606,
        files={
            "src/lib/server/catalog/plain-food.ts": "export const plain = true;\n",
            "scripts/eval/search-eval.ts": "// the search evaluation harness\n",
        },
        changed=["scripts/eval/search-eval.ts", "src/lib/server/catalog/plain-food.ts"],
    )
    world.given_gate_outcomes(**{"verify:changed": "pass"})

    result = run_flow(world, 606, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "re-validating mechanic attempt 1 from its retained reply" in result.stdout
    assert "forbidden file changed" not in result.stdout
    assert "🔒 #606 (domain) frozen at" in result.stdout
    assert len(_talks(world, "mechanic", "story-606-domain")) == 2  # nothing new was asked


def test_a_resumed_run_relaunches_the_correction_a_forbidden_change_earned(world):
    """A forbidden change is corrected, not stopped on - and the correction
    survives the run that died before it reached an agent. The resumed run
    relaunches it with the same diagnostic, the file still sitting in the
    worktree, and the slice freezes once the agent puts it back."""
    _given_planned_story(world, 607)
    _delegate_mechanic(world, 607)
    world.agent_implements(
        "story-607-domain",
        "mechanic",
        files={**IMPLEMENTATION, "quality/thresholds.json": "{}\n"},
        changed_files=["quality/thresholds.json", *CHANGED],
    )
    world.agent_fails("story-607-domain", "mechanic", "provider unavailable")
    first = run_flow(world, 607)
    assert first.returncode == 21, first.stdout + first.stderr
    assert "forbidden file changed: quality/thresholds.json" in first.stdout
    assert (world.slice_worktree_path("story-607-domain") / "quality/thresholds.json").exists()

    world.agent_implements(
        "story-607-domain",
        "mechanic",
        files={},
        delete=["quality/thresholds.json"],
        changed_files=CHANGED,
        summary="put the thresholds back; the slice does not need them",
    )

    result = run_flow(world, 607, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "relaunching mechanic attempt 2" in result.stdout
    relaunched = _talks(world, "mechanic", "story-607-domain")[-1]["prompt"]
    assert "forbidden file changed: quality/thresholds.json" in relaunched
    assert "🔒 #607 (domain) frozen at" in result.stdout


def _stopped_early_by_a_repeated_diagnostic(world, number: int) -> None:
    """A first run whose agent kept the same out-of-reach file through its
    corrective turn: the second rejection is the first one verbatim, so the
    loop stopped there instead of spending the third attempt."""
    _given_planned_story(world, number)
    _delegate_mechanic(world, number)
    for _ in range(2):
        world.agent_implements(
            f"story-{number}-domain",
            "mechanic",
            files={**IMPLEMENTATION, "quality/thresholds.json": "{}\n"},
            changed_files=["quality/thresholds.json", *CHANGED],
        )
    first = run_flow(world, number)
    assert first.returncode == 22, first.stdout + first.stderr
    assert "stopped early: attempt 2 failed exactly as attempt 1" in first.stdout
    assert world.run_record(number)["slices"]["domain"]["turns"][-1]["repeated"] is True


def test_a_run_stopped_for_a_repeated_diagnostic_stays_stopped_on_resume(world):
    """Re-deriving that turn's verdict is a function of the bytes it left:
    with the worktree untouched it can only reach the same diagnostic and
    stop on it again, so the resume refuses instead of spending the turn."""
    _stopped_early_by_a_repeated_diagnostic(world, 608)

    result = run_flow(world, 608, "--resume")

    assert result.returncode == 30, result.stdout + result.stderr
    assert "was stopped early: mechanic attempt 2 failed exactly as attempt 1" in result.stdout
    assert "nothing in the worktree has changed since" in result.stdout
    # block 1's turn and the two the stopped run spent: no new agent call
    assert len(_talks(world, "mechanic", "story-608-domain")) == 3


def test_a_worktree_changed_after_an_early_stop_gets_the_ordinary_digest_refusal(world):
    """The repetition refusal never masks the digest: bytes that moved
    since the turn ended are not that turn's work, and that is what the
    resumed run says."""
    _stopped_early_by_a_repeated_diagnostic(world, 609)
    (world.slice_worktree_path("story-609-domain") / "quality/thresholds.json").write_text(
        '{"edited": "by hand"}\n'
    )

    result = run_flow(world, 609, "--resume")

    assert result.returncode == 30, result.stdout + result.stderr
    assert "worktree changed since mechanic attempt 2 ended" in result.stdout
    assert "was stopped early" not in result.stdout


def test_resume_refuses_a_worktree_that_changed_since_the_turn_ended(world):
    _stopped_by_a_gate_crash(world, 604)
    (world.slice_worktree_path("story-604-domain") / "src/lib/delegate.ts").write_text(
        "export const delegate = 'edited by hand';\n"
    )
    world.given_gate_outcomes(**{"verify:changed": "pass"})

    result = run_flow(world, 604, "--resume")

    assert result.returncode == 30, result.stdout + result.stderr
    assert "worktree changed since mechanic attempt 1 ended" in result.stdout
    assert len(_talks(world, "mechanic", "story-604-domain")) == 2


def test_resume_keeps_a_frozen_sibling_and_continues_only_the_other(world):
    _given_planned_split(world, 605)
    world.planner_answers_delegate(
        605,
        [
            delegate_slice(605, "domain", mechanic_signals()),
            delegate_slice(605, "ui", mechanic_signals()),
        ],
    )
    world.agent_implements(
        "story-1000-domain",
        "mechanic",
        files={"src/lib/split.ts": "export const split = true;\n"},
        changed_files=["src/lib/split.ts"],
        rendezvous="both-launched",
    )
    world.agent_fails("story-1001-ui", "mechanic", "down", rendezvous="both-launched")
    first = run_flow(world, 605)
    assert first.returncode == 21, first.stdout + first.stderr
    assert world.run_record(605)["slices"]["domain"]["state"] == "succeeded"
    world.agent_implements(
        "story-1001-ui",
        "mechanic",
        files={"src/routes/split.svelte": "<p>split</p>\n"},
        changed_files=["src/routes/split.svelte"],
    )

    result = run_flow(world, 605, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Starting 2 implementation loops" not in result.stdout
    assert "relaunching mechanic attempt 1" in result.stdout
    # the frozen domain slice was carried, never rerun
    assert len(_talks(world, "mechanic", "story-1000-domain")) == 2
    assert len(_talks(world, "mechanic", "story-1001-ui")) == 3


# --- resume: blocks 2, 4 and 5 ---------------------------------------------------


def test_resume_redoes_block_2_when_no_assignment_was_accepted(world):
    _given_planned_story(world, 610)
    world.planner_keeps_rejecting(
        610, [delegate_slice(610, "domain", mechanic_signals(objective_clear="maybe"))]
    )
    first = run_flow(world, 610)
    assert first.returncode == 27, first.stdout + first.stderr
    _delegate_mechanic(world, 610)
    world.agent_implements(
        "story-610-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )

    result = run_flow(world, 610, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "continuing at block 2" in result.stdout
    assert "🎯 #610 (domain) → mechanic" in result.stdout
    # the failing tests block 1 wrote were kept: one test-writing turn ever
    assert len(_talks(world, "mechanic", "story-610-domain")) == 2


def test_resume_after_a_red_ci_reuses_the_integration_branch_and_pr(world):
    _given_planned_story(world, 611)
    _delegate_mechanic(world, 611)
    world.agent_implements(
        "story-611-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )
    world.given_checks(500, ["fail", "pending", "fail"])
    first = run_flow(world, 611)
    assert first.returncode == 28, first.stdout + first.stderr
    assert world.run_record(611)["delivery"]["pr_number"] == 500
    world.given_checks(500, "pass")

    result = run_flow(world, 611, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Every slice is frozen and reported: continuing at block 4" in result.stdout
    assert "Integration worktree story-611 retained at" in result.stdout
    assert "Opened PR" not in result.stdout
    assert "🤝 Merged PR #500" in result.stdout
    assert world.pull(500)["state"] == "MERGED"


def test_resume_after_the_merge_continues_at_block_5(world):
    _given_planned_story(world, 612)
    _delegate_mechanic(world, 612)
    world.agent_implements(
        "story-612-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )
    first = run_flow(world, 612)
    assert first.returncode == 0, first.stdout + first.stderr

    def died_after_the_merge(state):
        state["terminal"] = "DELIVERED"
        state["delivery"].pop("ship", None)

    world.rewrite_run_record(612, died_after_the_merge)

    result = run_flow(world, 612, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "PR #500 is merged: continuing at block 5" in result.stdout
    assert world.run_record(612)["terminal"] == "SHIPPED"
    assert world.ship_record(612)["cleanup"]["removed"] == []


def test_resume_needs_a_retained_record_an_open_story_and_no_human_hold(world):
    world.given_story(620, title="Never run", labels=["story"])
    assert run_flow(world, 620, "--resume").returncode == 20
    world.given_story(621, title="Paused", labels=["story", "paused"])
    result = run_flow(world, 621, "--resume")
    assert result.returncode == 20
    assert "held by paused" in result.stdout
    assert not any(call.get("tool") == "aarmy" for call in world.calls())


def test_resume_refuses_a_shipped_run(world):
    _given_planned_story(world, 622)
    _delegate_mechanic(world, 622)
    world.agent_implements(
        "story-622-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )
    assert run_flow(world, 622).returncode == 0

    result = run_flow(world, 622, "--resume")

    assert result.returncode == 20, result.stdout + result.stderr
    assert "already shipped" in result.stdout


def test_resume_and_reset_need_an_issue_number(world):
    for flag in ("--resume", "--reset"):
        result = run_flow(world, flag)
        assert result.returncode == 2
        assert "need an issue number" in result.stderr


# --- reset ------------------------------------------------------------------------


def test_reset_undoes_a_failed_run_and_a_fresh_run_can_start(world):
    _stopped_by_an_agent_failure(world, 630, files={"src/lib/domain/partial.ts": "// partial\n"})
    assert world.slice_worktree_path("story-630-domain").exists()
    assert world.branch_exists_on_origin("story-630-domain")

    result = run_flow(world, 630, "--reset")

    assert result.returncode == 0, result.stdout + result.stderr
    assert not world.slice_worktree_path("story-630-domain").exists()
    assert not world.branch_exists_on_origin("story-630-domain")
    assert world.issue(630)["labels"] == ["story"]
    assert not (world.home / "runs" / "story-630.json").exists()
    assert len(world.archived_run_records(630)) == 1
    assert any(c.startswith("Reset by `go.py --reset`") for c in world.issue(630)["comments"])
    assert "removed worktree `story-630-domain`" in result.stdout
    assert "deleted `story-630-domain` on origin" in result.stdout
    # the worktree is force-removed a line later, so the log says so - and
    # keeps the file list, the only record of what was thrown away
    assert "dirty (removed; uncommitted changes were):" in result.stdout
    assert "?? src/lib/domain/partial.ts" in result.stdout
    assert "preserved for audit" not in result.stdout

    # the story is a fresh pick again
    _given_planned_story(world, 630)
    _delegate_mechanic(world, 630)
    world.agent_implements(
        "story-630-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )
    again = run_flow(world, 630)
    assert again.returncode == 0, again.stdout + again.stderr


def test_reset_closes_the_children_and_an_open_pr(world):
    _given_planned_story(world, 631)
    _delegate_mechanic(world, 631)
    world.agent_implements(
        "story-631-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )
    world.given_checks(500, ["fail", "pending", "fail"])
    assert run_flow(world, 631).returncode == 28

    result = run_flow(world, 631, "--reset")

    assert result.returncode == 0, result.stdout + result.stderr
    assert world.pull(500)["state"] == "CLOSED"
    assert "closed PR #500" in result.stdout
    assert not world.slice_worktree_path("story-631").exists()
    assert not world.branch_exists_on_origin("story-631")
    assert not world.branch_exists_on_origin("story-631-domain")


def test_reset_of_a_split_story_closes_both_children(world):
    _given_planned_split(world, 632)
    world.planner_answers_delegate(
        632,
        [
            delegate_slice(632, "domain", mechanic_signals()),
            delegate_slice(632, "ui", mechanic_signals()),
        ],
    )
    world.agent_fails("story-1000-domain", "mechanic", "down", rendezvous="both")
    world.agent_fails("story-1001-ui", "mechanic", "down", rendezvous="both")
    assert run_flow(world, 632).returncode == 21

    result = run_flow(world, 632, "--reset")

    assert result.returncode == 0, result.stdout + result.stderr
    assert world.issue(1000)["state"] == "CLOSED"
    assert world.issue(1001)["state"] == "CLOSED"
    assert world.issue(632)["state"] == "OPEN"
    assert not world.slice_worktree_path("story-1000-domain").exists()
    assert not world.slice_worktree_path("story-1001-ui").exists()


def test_reset_without_a_record_cleans_by_name(world):
    """A run that died in block 1 left worktrees, branches and children,
    but no record: `--reset` finds them by the names the driver gives."""
    world.given_story(633, title="Split resume", labels=["story"])
    world.planner_answers_whose_call(
        633,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        633,
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
    world.mechanic_writes(
        "story-1000-domain", files={domain_test: "// failing\n"}, test_files=[domain_test]
    )
    world.scripted_test_outcome(domain_test, ["fail"])
    world.mechanic_fails("story-1001-ui", "down")
    first = run_flow(world, 633)
    assert first.returncode == 21, first.stdout + first.stderr
    assert not (world.home / "runs" / "story-633.json").exists()
    assert world.slice_worktree_path("story-1000-domain").exists()

    result = run_flow(world, 633, "--reset")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "no retained record: by name" in result.stdout
    assert world.issue(1000)["state"] == "CLOSED"
    assert world.issue(1001)["state"] == "CLOSED"
    assert not world.slice_worktree_path("story-1000-domain").exists()
    assert not world.slice_worktree_path("story-1001-ui").exists()
    assert not world.branch_exists_on_origin("story-1000-domain")
    assert "in-progress" not in world.issue(633)["labels"]
    assert world.archived_run_records(633) == []


def test_reset_refuses_while_a_run_owns_the_story(world):
    _stopped_by_an_agent_failure(world, 634)
    lock_path = world.home / "locks" / "story-634.lock"
    with lock_path.open("w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        result = run_flow(world, 634, "--reset")

    assert result.returncode == 29, result.stdout + result.stderr
    assert world.slice_worktree_path("story-634-domain").exists()
    assert (world.home / "runs" / "story-634.json").exists()


def test_resume_after_a_red_ci_the_driver_can_read_takes_a_ci_fix_round(world):
    """#397's own stop, resumed: the record says the one rerun is spent and
    the checks are still red. The fix-round budget is not the rerun's, so the
    resumed run reads the log and fixes what it names instead of stopping at
    CAPACITY_EXHAUSTED again."""
    _given_planned_story(world, 613)
    _delegate_mechanic(world, 613)
    world.agent_implements(
        "story-613-domain", "mechanic", files=IMPLEMENTATION, changed_files=CHANGED
    )
    world.given_checks(500, ["fail", "pending", "fail"])
    first = run_flow(world, 613)
    assert first.returncode == 28, first.stdout + first.stderr
    assert world.run_record(613)["delivery"]["rerun_used"] is True

    world.given_failed_log(
        "ERROR: Coverage for lines (0%) does not meet global threshold (80%) "
        "for src/lib/delegate.ts"
    )
    world.given_checks(500, ["fail", "pending", "pass"])
    world.agent_implements(
        "story-613-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
        changed_files=CHANGED,
    )

    result = run_flow(world, 613, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "CI is red" in result.stdout
    assert "CI fix round 1/2 on PR #500: src/lib/delegate.ts" in result.stdout
    assert "Merged PR #500" in result.stdout
    record = world.run_record(613)
    assert record["delivery"]["ci_fix_rounds"] == 1
    # the spent rerun stays spent; the fix rounds are their own budget
    assert record["delivery"]["rerun_used"] is True


# --- resume: block 4's fix turns ------------------------------------------------

_FIX_FINDING = [
    {
        "file": "src/lib/delegate.ts",
        "line": 1,
        "category": "correctness",
        "required_fix": "the constant must be a number",
    }
]
FIXED = {"src/lib/delegate.ts": "export const delegate = 2;\n"}


def _given_a_fix_verdict(world, number: int) -> None:
    """A reviewed run that reached block 4 and was asked for one fix."""
    _given_planned_story(world, number)
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", builder_signals())])
    world.agent_implements(
        f"story-{number}-domain", "builder", files=IMPLEMENTATION, changed_files=CHANGED
    )
    world.reviewer_answers(number, "fix", _FIX_FINDING)


def test_resume_relaunches_a_review_fix_turn_that_never_replied(world):
    """#406 run 4's record, once the fix turn is a bounded request: the turn
    left no reply, so it is voided and relaunched under the same attempt -
    not a reset."""
    _given_a_fix_verdict(world, 630)
    world.agent_fails("story-630-domain", "builder", "provider unavailable")
    first = run_flow(world, 630)
    assert first.returncode == 21, first.stdout + first.stderr
    record = world.run_record(630)["slices"]["domain"]
    assert record["turns"][-1]["kind"] == "review_fix"
    assert record["state"] == "failed"

    world.agent_implements("story-630-domain", "builder", files=FIXED, changed_files=CHANGED)
    world.reviewer_answers(630, "merge")

    result = run_flow(world, 630, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "A block 4 fix was interrupted: continuing at block 4" in result.stdout
    assert "stopped in a review fix: fix attempt 1 left no reply" in result.stdout
    assert "review fix attempt 1/3" in result.stdout
    assert world.pull(500)["state"] == "MERGED"
    turns = [
        turn
        for turn in world.run_record(630)["slices"]["domain"]["turns"]
        if turn["kind"] == "review_fix"
    ]
    assert [turn["result"] for turn in turns] == ["void", "ok"]
    assert [turn["fix_attempt"] for turn in turns] == [1, 1]


def test_resume_re_judges_a_review_fix_turn_from_its_retained_reply(world):
    """The fix turn replied and the driver died judging it. The reply and
    the tree digest are on the ledger, so the verdict is re-derived on the
    same bytes - no second agent call for that turn."""
    _given_a_fix_verdict(world, 631)
    world.agent_implements("story-631-domain", "builder", files=FIXED, changed_files=CHANGED)
    # the acceptance runner dies while the fix turn is being judged: an
    # external failure, after the turn's reply and digest are on the ledger
    world.scripted_test_outcome("src/lib/delegate.spec.ts", ["fail", "pass", "tool_error"])
    first = run_flow(world, 631)
    assert first.returncode == 26, first.stdout + first.stderr
    assert len(_talks(world, "builder", "story-631-domain")) == 2

    world.scripted_test_outcome("src/lib/delegate.spec.ts", "pass")
    world.reviewer_answers(631, "merge")

    result = run_flow(world, 631, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "re-validating its review fix attempt 1 from its retained reply" in result.stdout
    assert "🔧 Builder #631 (domain) review fix" not in result.stdout
    assert len(_talks(world, "builder", "story-631-domain")) == 2
    assert world.pull(500)["state"] == "MERGED"
    assert world.run_record(631)["slices"]["domain"]["state"] == "succeeded"
