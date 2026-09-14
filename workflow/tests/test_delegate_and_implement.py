"""End-to-end tests for blocks 2-3: delegation, bounded implementation
loops, escalation, parallel slices and the final barrier. Black-box like
test_pick_and_plan: every assertion is on go.py's exit code, its log, and
the fake-world state after the run.
"""

import fcntl
import json
import re
import subprocess

from conftest import (
    delegate_slice,
    mechanic_signals,
    run_flow,
    solver_signals,
)


def _option(argv: list[str], name: str) -> str:
    return argv[argv.index(name) + 1]


def _given_planned_story(
    world, number: int, layer: str = "domain", test_kind: str = "vitest"
) -> str:
    """Script the whole of block 1: one slice, failing tests written,
    validated and pushed. Returns the acceptance test file."""
    world.given_story(number, title="Delegated story", labels=["story"])
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
                "title": "Delegated work",
                "brief": "Add the behavior the acceptance test names.",
                "acceptance": ["The named behavior is observable."],
                "test_kind": test_kind,
            }
        ],
    )
    slug = f"story-{number}-{layer}"
    if test_kind == "playwright":
        test_file = "src/routes/delegate.e2e.ts"
    else:
        test_file = "src/lib/delegate.spec.ts"
    world.mechanic_writes(slug, files={test_file: "// failing\n"}, test_files=[test_file])
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    return test_file


def _given_planned_split(
    world, number: int, domain_outcomes: list[str], ui_outcomes: list[str]
) -> tuple[str, str]:
    world.given_story(number, title="Split delegation", labels=["story"])
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
    world.scripted_test_outcome(domain_test, domain_outcomes)
    world.scripted_test_outcome(ui_test, ui_outcomes)
    return domain_test, ui_test


def _delegate_mechanic(world, number: int, layer: str = "domain") -> None:
    world.planner_answers_delegate(number, [delegate_slice(number, layer, mechanic_signals())])


def _implement(world, slug: str, role: str, files: dict[str, str], **kwargs) -> None:
    world.agent_implements(slug, role, files=files, changed_files=sorted(files), **kwargs)


def _implement_every_attempt(world, slug: str, role: str, files: dict[str, str]) -> None:
    """The same rejected diff at every attempt the role gets. An
    out-of-reach path is corrected, not stopped on, so a run only reaches
    the contract stop when the agent leaves the path there to the end -
    which an identical diff reaches on the second attempt, since a
    diagnostic that repeats verbatim ends the budget where it stands."""
    for _ in range(2):
        _implement(world, slug, role, files=files)


def delegate_turns(world, story_number: int) -> list[dict]:
    """The planner's delegation-signals turns so far (whose-call and the
    slicing turns share its team but a different schema)."""
    return [
        call
        for call in _talks(world, "planner", f"plan-{story_number}")
        if call["argv"][call["argv"].index("--schema") + 1].endswith("delegate.json")
    ]


def _talks(world, role: str, team: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", role]
        and call["argv"][call["argv"].index("--team") + 1] == team
    ]


# --- happy paths ---------------------------------------------------------------


def test_single_slice_implements_on_the_first_attempt(world):
    _given_planned_story(world, 400)
    _delegate_mechanic(world, 400)
    _implement(
        world,
        "story-400-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🎯 #400 (domain) → mechanic" in result.stdout
    assert "🚦 Pre-launch barrier" in result.stdout
    assert "🔒 #400 (domain) frozen at" in result.stdout
    assert "🏁 Implemented #400" in result.stdout
    assert any("Implemented:" in comment for comment in world.issue(400)["comments"])
    # one initial mechanic turn, no corrections, no escalation
    assert len(_talks(world, "mechanic", "story-400-domain")) == 2  # block 1 + block 3
    # implementation stayed local: what origin had for the slice branch - and
    # what block 5's cleanup recorded deleting - is the failing-test commit,
    # never the commit the driver froze after the implementation turn
    state = json.loads((world.home / "runs" / "story-400.json").read_text())
    deleted = state["delivery"]["ship"]["cleanup"]["remote_deleted"]["story-400-domain"]
    assert deleted != state["slices"]["domain"]["frozen_commit"]
    assert ["--add-label", "in-progress"] in world.label_edits(400)
    assert "blocked" not in world.issue(400)["labels"]


def test_two_corrections_at_the_same_level_then_success(world):
    _given_planned_story(world, 401)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 401)
    world.scripted_test_outcome(test_file, ["fail", "fail", "pass"])
    # attempt one changes nothing at all and attempt two implements the
    # wrong thing: two rejections that differ, so both corrections are
    # worth taking and the budget is not cut short
    world.agent_implements(
        "story-401-domain", "mechanic", files={}, changed_files=["src/lib/delegate.ts"]
    )
    _implement(
        world,
        "story-401-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const wrong2 = true;\n"},
    )
    _implement(
        world,
        "story-401-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    talks = _talks(world, "mechanic", "story-401-domain")
    assert len(talks) == 4  # block 1 + one initial + two corrections
    assert "correcting after attempt 1" in result.stdout
    assert "correcting after attempt 2" in result.stdout
    assert "no changes were made in the worktree" in talks[2]["prompt"]
    correction_prompt = talks[3]["prompt"]
    assert "rejected attempt 3" in correction_prompt
    assert "vitest src/lib/delegate.spec.ts still fails" in correction_prompt
    assert "stopped early" not in result.stdout
    assert "🔒 #401 (domain) frozen at" in result.stdout


def test_a_slice_whose_diagnostic_repeats_escalates_without_its_last_attempt(world):
    """An identical rejection ends the role's budget where it stands, and
    ends it exactly the way exhaustion would: the stronger role still gets
    its chance, because a stronger model is the thing that has not been
    tried. The escalation's own reason says how many attempts were left
    unspent."""
    _given_planned_story(world, 411)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 411)
    world.scripted_test_outcome(test_file, ["fail", "fail", "fail", "pass"])
    for _ in range(2):
        _implement(
            world,
            "story-411-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const wrong = true;\n"},
        )
    _implement(
        world,
        "story-411-domain",
        "builder",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "🛑 Mechanic #411 (domain) stopped early: attempt 2 failed exactly as attempt 1"
    ) in result.stdout
    assert "correcting after attempt 2" not in result.stdout
    assert "⏫ #411 (domain) escalating mechanic → builder (revision 1, attempts reset)" in (
        result.stdout
    )
    # block 1's mechanic turn plus two of the three block 3 attempts
    assert len(_talks(world, "mechanic", "story-411-domain")) == 3
    state = json.loads((world.home / "runs" / "story-411.json").read_text())
    recorded = state["slices"]["domain"]["turns"]
    assert [turn.get("repeated", False) for turn in recorded] == [False, True, False]
    assert recorded[1]["diagnostic"].startswith("vitest src/lib/delegate.spec.ts still fails")
    reason = state["slices"]["domain"]["assignments"][-1]["reason"]
    assert "1 of 3 attempts went unspent" in reason


def test_escalation_uses_the_builder_config_from_yaml(world):
    _given_planned_story(world, 402)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 402)
    world.scripted_test_outcome(test_file, ["fail"] * 3 + ["pass"])
    for _ in range(2):  # the same rejection twice ends the mechanic's budget
        _implement(
            world,
            "story-402-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const wrong = true;\n"},
        )
    _implement(
        world,
        "story-402-domain",
        "builder",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "⏫ #402 (domain) escalating mechanic → builder (revision 1, attempts reset)" in (
        result.stdout
    )
    builder_talks = _talks(world, "builder", "story-402-domain")
    assert len(builder_talks) == 1
    assert (
        _option(builder_talks[0]["argv"], "-b"),
        _option(builder_talks[0]["argv"], "-m"),
        _option(builder_talks[0]["argv"], "-e"),
    ) == ("claude", "sonnet", "medium")
    assert len(_talks(world, "mechanic", "story-402-domain")) == 3
    assert "🔒 #402 (domain) frozen at" in result.stdout


def test_solver_signals_select_the_solver_role_and_config(world):
    _given_planned_story(world, 403)
    world.planner_answers_delegate(
        403,
        [delegate_slice(403, "domain", solver_signals(sensitive_areas=["auth"]))],
    )
    _implement(
        world,
        "story-403-domain",
        "solver",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    world.reviewer_answers(403, "merge")

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🎯 #403 (domain) → solver · Selection row 3" in result.stdout
    solver_talks = _talks(world, "solver", "story-403-domain")
    assert len(solver_talks) == 1
    assert (
        _option(solver_talks[0]["argv"], "-b"),
        _option(solver_talks[0]["argv"], "-m"),
        _option(solver_talks[0]["argv"], "-e"),
    ) == ("claude", "opus", "high")


# --- exhaustion and external failure --------------------------------------------


def test_solver_exhaustion_stops_preserving_worktree_and_state(world):
    """Every rung spends every attempt: each role's first turn satisfies
    the acceptance tests but fails the turn gate, and its next two fail the
    acceptance run, so no two consecutive rejections are identical until
    the last attempt - where the budget has run out anyway."""
    _given_planned_story(world, 410)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 410)
    world.scripted_test_outcome(test_file, ["fail"] + ["pass", "fail", "fail"] * 3)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "fail", "fail"]})
    for role in ("mechanic", "builder", "solver"):
        for index in (1, 2, 3):
            _implement(
                world,
                "story-410-domain",
                role,
                files={"src/lib/delegate.ts": f"export const wrong_{role}_{index} = true;\n"},
            )

    result = run_flow(world)

    assert result.returncode == 28, result.stdout + result.stderr
    assert "solver exhausted its 3 attempts" in result.stdout
    assert "stopped early" not in result.stdout
    assert "exactly one level" not in result.stdout
    assert world.slice_worktree_path("story-410-domain").exists()
    assert "dirty (preserved for audit)" in "\n".join(world.issue(410)["comments"])
    issue = world.issue(410)
    assert "in-progress" in issue["labels"]
    assert "blocked" in issue["labels"]
    state = json.loads((world.home / "runs" / "story-410.json").read_text())
    assert state["terminal"] == "CAPACITY_EXHAUSTED"
    assert state["slices"]["domain"]["state"] == "failed"
    assert state["slices"]["domain"]["role"] == "solver"
    assert state["slices"]["domain"]["revision"] == 2
    assert state["slices"]["domain"]["attempts"] == 3
    assert len(state["slices"]["domain"]["assignments"]) == 3


def test_external_agent_failure_stops_immediately_without_retry(world):
    _given_planned_story(world, 411)
    _delegate_mechanic(world, 411)
    world.agent_fails("story-411-domain", "mechanic", "provider unavailable")

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    assert len(_talks(world, "mechanic", "story-411-domain")) == 2  # block 1 + the failed turn
    assert "retrying" not in result.stdout
    assert "escalating" not in result.stdout
    assert world.slice_worktree_path("story-411-domain").exists()
    assert "blocked" in world.issue(411)["labels"]


def test_runner_report_unparsable_is_external_and_never_a_retry(world):
    _given_planned_story(world, 412)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 412)
    _implement(
        world,
        "story-412-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    world.scripted_test_outcome(test_file, ["fail", "tool_error"])

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "retrying" not in result.stdout
    assert len(_talks(world, "mechanic", "story-412-domain")) == 2


# --- parallel slices, freezing, barrier ------------------------------------------


def test_two_slices_run_in_parallel_and_the_approved_one_freezes(world):
    _given_planned_split(world, 420, ["fail", "pass"], ["fail", "fail", "pass"])
    world.planner_answers_delegate(
        420,
        [
            delegate_slice(420, "domain", mechanic_signals()),
            delegate_slice(420, "ui", mechanic_signals()),
        ],
    )
    _implement(
        world,
        "story-1000-domain",
        "mechanic",
        files={"src/lib/split.ts": "export const split = true;\n"},
        rendezvous="split-freeze",
    )
    _implement(
        world,
        "story-1001-ui",
        "mechanic",
        files={"src/routes/split-page.ts": "export const partial = true;\n"},
        rendezvous="split-freeze",
    )
    _implement(
        world,
        "story-1001-ui",
        "mechanic",
        files={"src/routes/split-page.ts": "export const banner = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "⚡ Starting 2 implementation loops in parallel" in result.stdout
    assert "⏳ Implementation barrier: all 2 slices settled" in result.stdout
    # the approved domain slice was never rerun while ui corrected
    assert len(_talks(world, "mechanic", "story-1000-domain")) == 2  # block 1 + 1 turn
    assert len(_talks(world, "mechanic", "story-1001-ui")) == 3  # block 1 + 2 turns
    assert "🔒 #1000 (domain) frozen at" in result.stdout
    assert "🔒 #1001 (ui) frozen at" in result.stdout


def test_barrier_reports_the_first_failed_slice_in_domain_ui_order(world):
    _given_planned_split(world, 421, ["fail"] * 10, ["fail", "pass"])
    world.planner_answers_delegate(
        421,
        [
            delegate_slice(421, "domain", mechanic_signals()),
            delegate_slice(421, "ui", mechanic_signals()),
        ],
    )
    for role in ("mechanic", "builder", "solver"):
        for _ in range(3):
            _implement(
                world,
                "story-1000-domain",
                role,
                files={"src/lib/split.ts": "export const wrong = true;\n"},
            )
    _implement(
        world,
        "story-1001-ui",
        "mechanic",
        files={"src/routes/split-page.ts": "export const banner = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 28, result.stdout + result.stderr
    assert "⏳ Implementation barrier: all 2 slices settled" in result.stdout
    assert "❌ #1000 (domain): CAPACITY_EXHAUSTED" in result.stdout
    # the ui slice kept working and freezing while domain corrected and escalated
    assert len(_talks(world, "mechanic", "story-1001-ui")) == 2
    assert "🔒 #1001 (ui) frozen at" in result.stdout
    assert not any("Implemented:" in comment for comment in world.issue(421)["comments"])
    issue = world.issue(421)
    assert "blocked" in issue["labels"]
    # both worktrees are preserved, including the successful one
    assert world.slice_worktree_path("story-1000-domain").exists()
    assert world.slice_worktree_path("story-1001-ui").exists()


# --- selection gate rejections ----------------------------------------------------


def test_open_product_decision_stops_for_gabriel(world):
    _given_planned_story(world, 430)
    world.planner_answers_delegate(
        430,
        [delegate_slice(430, "domain", mechanic_signals(human_decision=True))],
    )

    result = run_flow(world)

    assert result.returncode == 11, result.stdout + result.stderr
    issue = world.issue(430)
    assert "needs-gabriel" in issue["labels"]
    assert "clarification" in "\n".join(issue["comments"]).lower()
    # only block 1's mechanic ran; no implementation worker started
    assert len(_talks(world, "mechanic", "story-430-domain")) == 1


def test_unclear_objective_stops_for_gabriel(world):
    _given_planned_story(world, 431)
    world.planner_answers_delegate(
        431,
        [delegate_slice(431, "domain", mechanic_signals(objective_clear=False))],
    )

    result = run_flow(world)

    assert result.returncode == 11, result.stdout + result.stderr
    assert "needs-gabriel" in world.issue(431)["labels"]


def test_unresolved_signal_rejects_the_contract_and_asks_for_replanning(world):
    _given_planned_story(world, 432)
    proposal = delegate_slice(432, "domain", mechanic_signals())
    proposal["unresolved"] = ["cause_uncertain"]
    world.planner_keeps_rejecting(432, [proposal])

    result = run_flow(world)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "unresolved signals for domain" in result.stdout
    # the planner got its corrective budget before the run stopped
    planner_sessions = re.findall(r"Session:\s+(plan-\S+)", result.stdout)
    # two block-1 planning turns, then the corrective loop on the same session
    assert planner_sessions == ["plan-432/planner"] * 5
    assert "exhausted 3 attempts" in result.stdout
    assert "revised plan in a new run" in "\n".join(world.issue(432)["comments"]).lower()
    assert "blocked" in world.issue(432)["labels"]
    assert len(_talks(world, "mechanic", "story-432-domain")) == 1  # block 1 only


def test_extra_fields_reject_the_contract(world):
    _given_planned_story(world, 433)
    proposal = delegate_slice(433, "domain", mechanic_signals())
    proposal["worktree"] = "/tmp/other"
    world.planner_keeps_rejecting(433, [proposal])

    result = run_flow(world)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "unknown field(s) worktree" in result.stdout


def test_missing_evidence_for_a_signal_rejects_the_contract(world):
    _given_planned_story(world, 434)
    proposal = delegate_slice(434, "domain", mechanic_signals())
    proposal["evidence"] = [
        entry for entry in proposal["evidence"] if entry["signal"] != "pattern_known"
    ]
    world.planner_keeps_rejecting(434, [proposal])

    result = run_flow(world)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "no evidence for signal(s) pattern_known" in result.stdout


def test_a_domain_slice_depending_on_the_ui_slice_is_rejected_before_any_worker_starts(world):
    """The accepted dependency runs one way only: a UI slice may wait for
    its domain sibling (test_dependent_slices.py), never the reverse."""
    _given_planned_split(world, 435, ["fail", "pass"], ["fail", "pass"])
    proposals = [
        delegate_slice(435, "domain", mechanic_signals()),
        delegate_slice(435, "ui", mechanic_signals()),
    ]
    proposals[0]["needs_sibling"] = True
    world.planner_keeps_rejecting(435, proposals)

    result = run_flow(world)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "a domain slice must never depend on the UI slice" in result.stdout
    assert "revised plan" in result.stdout or "replan" in result.stdout.lower()
    # the pre-launch barrier launched no implementation worker
    implementation_talks = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] != ["talk", "planner"]
        and call.get("argv", [None, None])[0:2] != ["talk", "mechanic"]
    ]
    assert implementation_talks == []
    mechanic_talks_after_block1 = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy" and call["argv"][0:2] == ["talk", "mechanic"]
    ]
    assert len(mechanic_talks_after_block1) == 2  # the two block-1 test-writing turns


def test_the_only_slice_of_a_story_cannot_depend_on_a_sibling_it_does_not_have(world):
    _given_planned_story(world, 436)
    proposal = delegate_slice(436, "domain", mechanic_signals())
    proposal["needs_sibling"] = True
    world.planner_keeps_rejecting(436, [proposal])

    result = run_flow(world)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "has no sibling to depend on" in result.stdout


# --- contract stops during implementation -----------------------------------------


def test_implementation_agent_committing_or_pushing_is_a_contract_stop(world):
    _given_planned_story(world, 440)
    _delegate_mechanic(world, 440)
    world.agent_implements(
        "story-440-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        changed_files=["src/lib/delegate.ts"],
        summary="committed my own work",
        commit=True,
        push=True,
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "implementation agents never" in result.stdout
    assert len(_talks(world, "mechanic", "story-440-domain")) == 2  # no retry


def test_modifying_an_acceptance_test_is_a_contract_stop(world):
    _given_planned_story(world, 441)
    _delegate_mechanic(world, 441)
    _implement(
        world,
        "story-441-domain",
        "mechanic",
        files={
            "src/lib/delegate.ts": "export const delegate = true;\n",
            "src/lib/delegate.spec.ts": "// weakened\n",
        },
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "src/lib/delegate.spec.ts was modified" in result.stdout


def test_a_forbidden_file_gets_one_corrective_turn_and_the_reverted_tree_passes(world):
    """`quality/` is a gate the agent is judged by, so it stays out of reach
    of an implementation turn - but reaching into it is a mistake the same
    agent can undo. It is told which path to put back, does, and the slice
    freezes on the work it got right (#337)."""
    _given_planned_story(world, 441)
    _delegate_mechanic(world, 441)
    _implement(
        world,
        "story-441-domain",
        "mechanic",
        files={
            "src/lib/delegate.ts": "export const delegate = true;\n",
            "quality/mutation-equivalents.json": "{}\n",
        },
    )
    world.agent_implements(
        "story-441-domain",
        "mechanic",
        files={},
        delete=["quality/mutation-equivalents.json"],
        changed_files=["src/lib/delegate.ts"],
        summary="put the equivalents file back; the slice does not need it",
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "forbidden file changed: quality/mutation-equivalents.json" in result.stdout
    assert "those paths are outside this slice's reach" in result.stdout
    assert "correcting after attempt 1" in result.stdout
    assert "🔒 #441 (domain) frozen at" in result.stdout
    # the correction the same agent gets names the path it must revert
    correction = _talks(world, "mechanic", "story-441-domain")[2]["prompt"]
    assert "forbidden file changed: quality/mutation-equivalents.json" in correction


def test_a_forbidden_file_still_there_after_the_budget_stops_the_run(world):
    """The correction is a chance, not a pardon: an agent that keeps the
    out-of-reach change through the corrective turn breaks the contract -
    and repeating the rejection verbatim is what ends the budget there."""
    _given_planned_story(world, 442)
    _delegate_mechanic(world, 442)
    _implement_every_attempt(
        world,
        "story-442-domain",
        "mechanic",
        files={
            "src/lib/delegate.ts": "export const delegate = true;\n",
            "quality/mutation-equivalents.json": "{}\n",
        },
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "AGENT_BROKE_CONTRACT (exit 22)" in result.stdout
    assert "forbidden file changed: quality/mutation-equivalents.json" in result.stdout
    state = json.loads((world.home / "runs" / "story-442.json").read_text())
    assert state["terminal"] == "AGENT_BROKE_CONTRACT"
    assert state["slices"]["domain"]["attempts"] == 2
    assert "1 of 3 attempts went unspent" in result.stdout
    # the breach is never escalated to a stronger role: no model is the
    # answer to "you changed a file you may not change"
    assert "escalating mechanic → builder" not in result.stdout


def test_the_scripts_that_run_the_gates_stay_out_of_reach(world):
    _given_planned_story(world, 443)
    _delegate_mechanic(world, 443)
    _implement_every_attempt(
        world,
        "story-443-domain",
        "mechanic",
        files={
            "src/lib/delegate.ts": "export const delegate = true;\n",
            "scripts/quality/gate.ts": "// loosened\n",
        },
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "forbidden file changed: scripts/quality/gate.ts" in result.stdout


def test_an_application_script_is_in_reach_of_a_domain_slice(world):
    """`scripts/` holds the application's own tooling as well as the gates'
    - the ETL pipeline, the search evaluation harness, the dev and build
    helpers - and a story may perfectly well be about one. Only the gate
    folders are out of reach; #337 lost a run to the whole tree being
    forbidden."""
    _given_planned_story(world, 444)
    _delegate_mechanic(world, 444)
    _implement(
        world,
        "story-444-domain",
        "mechanic",
        files={
            "src/lib/server/catalog/plain-food.ts": "export const plain = true;\n",
            "scripts/eval/search-eval.ts": "// the search evaluation harness\n",
        },
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "forbidden file changed" not in result.stdout
    assert "🔒 #444 (domain) frozen at" in result.stdout


def test_the_implementation_brief_names_the_forbidden_prefixes(world):
    """The rule the agent is told is rendered from the constant it is judged
    by, so the two cannot drift - and it names paths, not a category the
    agent has to guess at."""
    _given_planned_story(world, 445)
    _delegate_mechanic(world, 445)
    _implement(
        world,
        "story-445-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    brief = _talks(world, "mechanic", "story-445-domain")[1]["prompt"]
    prohibited = brief.split("Out of reach")[-1].split("Everything else")[0]
    for prefix in (
        "`.github/`",
        "`quality/`",
        "`scripts/ci/`",
        "`scripts/deploy/`",
        "`scripts/github/`",
        "`scripts/quality/`",
        "`scripts/security/`",
    ):
        assert prefix in prohibited, prohibited
    assert "`bun.lock`" in prohibited
    assert "`playwright.config.ts`" in prohibited
    assert "`*.snap`" in prohibited
    # and never the whole scripts tree, which is what #337 read as forbidden
    assert "`scripts/`" not in prohibited


def test_a_domain_slice_may_implement_driver_files(world):
    """The driver's own code is not a forbidden prefix: an agent may
    implement a change to `workflow/` in a domain slice, and block 3
    validates it like any other domain file. Block 4 is where such a change
    is held back from the merge."""
    _given_planned_story(world, 441)
    _delegate_mechanic(world, 441)
    _implement(
        world,
        "story-441-domain",
        "mechanic",
        files={"workflow/fitflow/retry.py": "RETRIES = 1\n"},
    )

    result = run_flow(world)

    assert "forbidden file changed" not in result.stdout
    assert "🏁 Implemented #441" in result.stdout
    # block 4 then holds the merge itself: the driver never merges its own
    # code (test_a_driver_change_is_implemented_but_handed_to_gabriel_to_merge)
    assert result.returncode == 11, result.stdout + result.stderr


def test_a_phantom_reported_file_is_corrected_from_the_diff(world):
    """Nothing the driver trusts comes from the report, so a list naming a
    path the diff never touched costs the turn nothing: scope, acceptance
    and the gates have all just passed on the real diff, and that diff
    replaces the list on the record."""
    _given_planned_story(world, 442)
    _delegate_mechanic(world, 442)
    world.agent_implements(
        "story-442-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        changed_files=["src/lib/delegate.ts", "src/lib/never-touched.ts"],
        summary="reported a file I never wrote",
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "reported files corrected from the diff" in result.stdout
    assert "phantom src/lib/never-touched.ts" in result.stdout
    # with nothing unreported, the message names only the phantom side (#382)
    assert "unreported" not in result.stdout
    assert "correcting after attempt 1" not in result.stdout
    assert "🔒 #442 (domain) frozen at" in result.stdout
    turn = world.run_record(442)["slices"]["domain"]["turns"][-1]
    assert turn["reply"]["changed_files"] == ["src/lib/delegate.ts"]
    assert turn["reported_files_corrected"] == "phantom src/lib/never-touched.ts"


def test_a_misreported_list_spends_no_attempt_at_all(world):
    """It used to be an ordinary repairable diagnostic, and three of them
    at one role escalated it (#496). A list that is wrong on both sides is
    still only a list: the turn that carries it passes, and the role keeps
    every attempt for the work."""
    _given_planned_story(world, 496)
    _delegate_mechanic(world, 496)
    world.agent_implements(
        "story-496-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        changed_files=["src/lib/never-touched.ts"],
        summary="the wrong list on both sides",
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "unreported src/lib/delegate.ts; phantom src/lib/never-touched.ts" in result.stdout
    assert "⏫" not in result.stdout
    assert "🔒 #496 (domain) frozen at" in result.stdout
    turns = world.run_record(496)["slices"]["domain"]["turns"]
    assert [turn["attempt"] for turn in turns] == [1]


def test_a_forbidden_file_outranks_a_wrong_list_in_the_diagnostic(world):
    """Every verdict on the real diff outranks the reply's account of it:
    the agent is corrected about the forbidden change it hid, never about
    the list it got wrong while hiding it - and a budget spent on the same
    concealment still ends the run."""
    _given_planned_story(world, 497)
    _delegate_mechanic(world, 497)
    for _ in range(3):
        world.agent_implements(
            "story-497-domain",
            "mechanic",
            files={
                "src/lib/delegate.ts": "export const delegate = true;\n",
                "quality/mutation-equivalents.json": "{}\n",
            },
            changed_files=["src/lib/never-touched.ts"],
            summary="edited the equivalents file and said nothing",
        )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "forbidden file changed: quality/" in result.stdout
    assert "reported files do not match the actual diff" not in result.stdout


# --- duplicate execution protection ------------------------------------------------


def test_a_second_execution_on_a_locked_story_starts_no_workers(world):
    _given_planned_story(world, 450)
    lock_path = world.home / "locks" / "story-450.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    with lock_path.open("w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        result = run_flow(world, "450")

    assert result.returncode == 29, result.stdout + result.stderr
    assert "already owns story #450" in result.stdout
    assert not any(call.get("tool") == "aarmy" for call in world.calls())


def test_run_state_file_records_the_run_for_audit(world):
    _given_planned_story(world, 451)
    _delegate_mechanic(world, 451)
    _implement(
        world,
        "story-451-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    state = json.loads((world.home / "runs" / "story-451.json").read_text())
    assert state["story_number"] == 451
    assert state["slices"]["domain"]["state"] == "succeeded"
    # the run now continues through block 4's merge, so the terminal outcome
    # is the delivery, not the block 3 boundary
    assert state["terminal"] == "SHIPPED"
    assert state["delivery"]["pr_number"] == 500
    assert state["delivery"]["verdict"] == "mechanical"
    assert state["slices"]["domain"]["frozen_commit"]
    assert state["slices"]["domain"]["assignments"][0]["role"] == "mechanic"
    assert state["slices"]["domain"]["assignments"][0]["config"]["model"] == "haiku"
    assert len(state["slices"]["domain"]["turns"]) == 1
    assert state["slices"]["domain"]["turns"][0]["status"] == "completed"
    assert state["slices"]["domain"]["turns"][0]["session"] == "story-451-domain/mechanic"


# --- review findings: turn gates, gate config, state protection -------------------


def _gate_calls(world) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "bun" and "verify:changed" in call.get("argv", [])
    ]


def test_pre_push_gates_run_before_the_slice_is_frozen(world):
    _given_planned_story(world, 460)
    _delegate_mechanic(world, 460)
    _implement(
        world,
        "story-460-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert len(_gate_calls(world)) == 1
    assert "🧪 Gates: verify:changed ✔ (3 steps)" in result.stdout
    calls = world.calls()
    gate = next(
        index
        for index, call in enumerate(calls)
        if call.get("tool") == "bun" and "verify:changed" in call["argv"]
    )
    implemented = next(
        index
        for index, call in enumerate(calls)
        if call.get("tool") == "gh"
        and "--body" in call["argv"]
        and call["argv"][call["argv"].index("--body") + 1].startswith("Implemented:")
    )
    assert gate < implemented


def test_a_failing_quality_gate_is_repairable_and_retries_the_same_role(world):
    _given_planned_story(world, 461)
    _delegate_mechanic(world, 461)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    _implement(
        world,
        "story-461-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-461-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "verify:changed failed steps: test:unit:server" in result.stdout
    assert "correcting after attempt 1" in result.stdout
    assert "🔒 #461 (domain) frozen at" in result.stdout


def test_a_crashed_gate_run_is_an_external_stop(world):
    _given_planned_story(world, 462)
    _delegate_mechanic(world, 462)
    _implement(
        world,
        "story-462-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    world.given_gate_outcomes(**{"verify:changed": "tool_error"})

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "left no gate report" in result.stdout
    assert len(_talks(world, "mechanic", "story-462-domain")) == 2  # no retry


def test_a_crashed_gate_run_is_retried_once_then_judged(world):
    """A fresh worktree's first mutation run can lose a transient race; the
    driver re-runs the gate once, the way QUALITY.md tells a human to,
    before judging the crash an external failure."""
    _given_planned_story(world, 465)
    _delegate_mechanic(world, 465)
    _implement(
        world,
        "story-465-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    world.given_gate_outcomes(**{"verify:changed": ["tool_error", "pass"]})

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "retrying once" in result.stdout
    # block 1's failing-tests turn plus the implementation turn; the gate
    # retry consumed no agent turn
    assert len(_talks(world, "mechanic", "story-465-domain")) == 2


def test_a_gate_that_crashes_twice_is_an_external_stop(world):
    _given_planned_story(world, 466)
    _delegate_mechanic(world, 466)
    _implement(
        world,
        "story-466-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    world.given_gate_outcomes(**{"verify:changed": "tool_error"})

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "left no gate report" in result.stdout
    assert len(_talks(world, "mechanic", "story-466-domain")) == 2  # no retry


def test_a_stale_gate_report_is_an_external_stop(world):
    _given_planned_story(world, 463)
    _delegate_mechanic(world, 463)
    _implement(
        world,
        "story-463-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    # the gate "passes" but leaves a report written an hour before the turn
    world.given_gate_outcomes(**{"verify:changed": "stale"})

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "gate report is stale" in result.stdout
    assert len(_talks(world, "mechanic", "story-463-domain")) == 2  # no retry


def test_changing_gate_or_runner_configuration_is_a_contract_stop(world):
    _given_planned_story(world, 464)
    _delegate_mechanic(world, 464)
    _implement_every_attempt(
        world,
        "story-464-domain",
        "mechanic",
        files={
            "src/lib/delegate.ts": "export const delegate = true;\n",
            "playwright.config.ts": "// test discovery narrowed\n",
        },
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "forbidden file changed: playwright.config.ts" in result.stdout


def test_a_ui_slice_reaching_into_the_domain_gets_a_corrective_turn(world):
    """The layer boundary is corrected the same way an out-of-reach gate
    file is: the agent is told which path belongs to the other slice, puts
    it back, and the run continues on the half it got right."""
    _given_planned_story(world, 465, layer="ui", test_kind="playwright")
    world.planner_answers_delegate(465, [delegate_slice(465, "ui", mechanic_signals())])
    _implement(
        world,
        "story-465-ui",
        "mechanic",
        files={
            "src/routes/banner/+page.svelte": "<p>banner</p>\n",
            "src/lib/domain/banner.ts": "export const banner = true;\n",
        },
    )
    world.agent_implements(
        "story-465-ui",
        "mechanic",
        files={},
        delete=["src/lib/domain/banner.ts"],
        changed_files=["src/routes/banner/+page.svelte"],
        summary="put the domain module back; it belongs to the domain slice",
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "ui slice changed a domain file outside its scope" in result.stdout
    assert "correcting after attempt 1" in result.stdout
    assert "🔒 #465 (ui) frozen at" in result.stdout


def test_a_ui_slice_that_keeps_the_domain_file_stops_the_run(world):
    _given_planned_story(world, 474, layer="ui", test_kind="playwright")
    world.planner_answers_delegate(474, [delegate_slice(474, "ui", mechanic_signals())])
    _implement_every_attempt(
        world,
        "story-474-ui",
        "mechanic",
        files={"src/lib/domain/banner.ts": "export const banner = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "ui slice changed a domain file outside its scope" in result.stdout


def test_a_domain_slice_cannot_implement_svelte_files(world):
    _given_planned_story(world, 466)
    _delegate_mechanic(world, 466)
    _implement_every_attempt(
        world,
        "story-466-domain",
        "mechanic",
        files={"src/routes/Banner.svelte": "<span />\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "domain slice changed a UI file: src/routes/Banner.svelte" in result.stdout


def test_a_domain_slice_cannot_implement_route_loaders(world):
    _given_planned_story(world, 469)
    _delegate_mechanic(world, 469)
    _implement_every_attempt(
        world,
        "story-469-domain",
        "mechanic",
        files={"src/routes/+page.server.ts": "export const load = () => ({});\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "domain slice changed a UI file: src/routes/+page.server.ts" in result.stdout


def test_a_domain_slice_cannot_implement_component_helpers(world):
    _given_planned_story(world, 470)
    _delegate_mechanic(world, 470)
    _implement_every_attempt(
        world,
        "story-470-domain",
        "mechanic",
        files={"src/lib/components/helpers.ts": "export const helper = 1;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "domain slice changed a UI file: src/lib/components/helpers.ts" in result.stdout


def test_a_ui_slice_cannot_implement_the_shared_store(world):
    _given_planned_story(world, 471, layer="ui", test_kind="playwright")
    world.planner_answers_delegate(471, [delegate_slice(471, "ui", mechanic_signals())])
    _implement_every_attempt(
        world,
        "story-471-ui",
        "mechanic",
        files={"src/lib/state/store.svelte.ts": "export const x = 1;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "ui slice changed the shared store outside its scope" in result.stdout


def test_a_ui_slice_may_delete_its_own_component_spec(world):
    """A UI slice may delete a component's own vitest spec: only the layer
    boundary and acceptance-test immutability guard the run (issue #399),
    not a rule that a playwright slice may only touch .e2e.ts tests."""
    spec_file = "src/routes/progress/page.svelte.spec.ts"
    (world.repo / "src" / "routes" / "progress").mkdir(parents=True)
    (world.repo / spec_file).write_text("// stale component spec\n")
    subprocess.run(["git", "add", spec_file], cwd=world.repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "seed stale spec"],
        cwd=world.repo,
        check=True,
        capture_output=True,
    )
    subprocess.run(["git", "push"], cwd=world.repo, check=True, capture_output=True)

    _given_planned_story(world, 472, layer="ui", test_kind="playwright")
    world.planner_answers_delegate(472, [delegate_slice(472, "ui", mechanic_signals())])
    world._queue_turn(
        "story-472-ui/mechanic",
        {
            "changed_files": ["src/routes/progress/+page.svelte", spec_file],
            "summary": "removed the stale component spec",
        },
        effects={
            "files": {"src/routes/progress/+page.svelte": "<div>done</div>\n"},
            "delete": [spec_file],
            "commit": False,
            "push": False,
        },
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr


def test_a_ui_slice_changing_a_domain_test_is_a_layer_boundary_stop(world):
    """A UI slice touching a test file in the domain layer is still
    stopped, but by the layer boundary rather than a wrong-kind rule."""
    _given_planned_story(world, 473, layer="ui", test_kind="playwright")
    world.planner_answers_delegate(473, [delegate_slice(473, "ui", mechanic_signals())])
    _implement_every_attempt(
        world,
        "story-473-ui",
        "mechanic",
        files={"src/lib/domain/banner.spec.ts": "// domain test\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert (
        "ui slice changed a domain file outside its scope: src/lib/domain/banner.spec.ts"
        in result.stdout
    )
    assert "wrong-kind" not in result.stdout


def test_an_omitted_deletion_is_corrected_from_the_diff(world):
    """The deleted path run 5 of issue #399 lost a whole run to: the diff
    touches it and the reply forgot it. The driver reads deletions off the
    diff itself, so it puts the path back on the list and says so, rather
    than asking a turn for it."""
    stale = "src/lib/stale.spec.ts"
    (world.repo / "src" / "lib").mkdir(parents=True, exist_ok=True)
    (world.repo / stale).write_text("// stale spec\n")
    subprocess.run(["git", "add", stale], cwd=world.repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "seed stale spec"],
        cwd=world.repo,
        check=True,
        capture_output=True,
    )
    subprocess.run(["git", "push"], cwd=world.repo, check=True, capture_output=True)

    _given_planned_story(world, 467)
    _delegate_mechanic(world, 467)
    world._queue_turn(
        "story-467-domain/mechanic",
        {"changed_files": ["src/lib/delegate.ts"], "summary": "deleted the stale spec"},
        effects={
            "files": {"src/lib/delegate.ts": "export const delegate = true;\n"},
            "delete": [stale],
            "commit": False,
            "push": False,
        },
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"reported files corrected from the diff: unreported {stale}" in result.stdout
    # with nothing phantom, the message names only the unreported side (#382)
    assert "phantom" not in result.stdout
    assert "correcting after attempt 1" not in result.stdout
    assert "🔒 #467 (domain) frozen at" in result.stdout
    state = json.loads((world.home / "runs" / "story-467.json").read_text())
    turns = state["slices"]["domain"]["turns"]
    assert {turn["session"] for turn in turns} == {"story-467-domain/mechanic"}
    assert sorted(turns[-1]["reply"]["changed_files"]) == ["src/lib/delegate.ts", stale]


def test_a_previous_runs_state_file_blocks_a_new_run(world):
    _given_planned_story(world, 468)
    _delegate_mechanic(world, 468)
    _implement(
        world,
        "story-468-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    # simulate an interrupted earlier run that left its retained record behind
    (world.home / "runs").mkdir(parents=True, exist_ok=True)
    (world.home / "runs" / "story-468.json").write_text('{"story_number": 468}')

    result = run_flow(world, "468")

    assert result.returncode == 30, result.stdout + result.stderr
    assert "left state at" in result.stdout
    assert "blocked" in world.issue(468)["labels"]
    # the retained record stops the fresh run at the pick, before block 1
    # asks the planner anything or launches a writer (#462)
    assert len(_talks(world, "mechanic", "story-468-domain")) == 0


# --- third review round: sessions, layer boundaries, truthful terminals ----------


def test_corrections_reuse_the_same_recorded_session(world):
    _given_planned_story(world, 480)
    _delegate_mechanic(world, 480)
    world.scripted_test_outcome("src/lib/delegate.spec.ts", ["fail", "fail", "pass"])
    # a phantom turn, then a wrong implementation, then the right one: three
    # turns in the same session, and no two rejections alike
    world.agent_implements(
        "story-480-domain", "mechanic", files={}, changed_files=["src/lib/delegate.ts"]
    )
    for index in (2, 3):
        _implement(
            world,
            "story-480-domain",
            "mechanic",
            files={"src/lib/delegate.ts": f"export const attempt{index} = true;\n"},
        )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    state = json.loads((world.home / "runs" / "story-480.json").read_text())
    sessions = [turn["session"] for turn in state["slices"]["domain"]["turns"]]
    assert sessions == ["story-480-domain/mechanic"] * 3


def test_a_changed_session_mid_role_is_a_contract_stop(world):
    _given_planned_story(world, 481)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 481)
    # attempt 1 leaves the acceptance test failing, so attempt 2 launches
    world.scripted_test_outcome(test_file, ["fail", "fail", "pass"])
    _implement(
        world,
        "story-481-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    # the correction comes back from a different session id
    world.agent_implements(
        "story-481-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
        changed_files=["src/lib/delegate.ts"],
        summary="corrected from a rogue session",
        session="story-481-domain/someone-else",
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "session changed mid-role" in result.stdout
    assert "blocked" in world.issue(481)["labels"]
    state = json.loads((world.home / "runs" / "story-481.json").read_text())
    assert state["terminal"] == "AGENT_BROKE_CONTRACT"
    # the rejected turn was settled, not left running: the ledger records it
    # completed with a failed result and the session the agent printed
    rejected = state["slices"]["domain"]["turns"][-1]
    assert rejected["status"] == "completed"
    assert rejected["result"] == "failed"
    assert rejected["session"] == "story-481-domain/someone-else"
    assert "session changed mid-role" in rejected["why"]
    assert state["slices"]["domain"]["state"] == "failed"


def test_a_missing_session_id_stops_the_flow_externally(world):
    _given_planned_story(world, 482)
    _delegate_mechanic(world, 482)
    world.agent_omits_session(
        "story-482-domain",
        "mechanic",
        {"changed_files": ["src/lib/delegate.ts"], "summary": "no session line"},
    )

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    assert "reply carries no session id" in result.stdout
    assert len(_talks(world, "mechanic", "story-482-domain")) == 2  # no retry
    state = json.loads((world.home / "runs" / "story-482.json").read_text())
    assert state["terminal"] == "AGENT_FAILED"


def test_escalation_establishes_a_distinct_session(world):
    _given_planned_story(world, 483)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 483)
    world.scripted_test_outcome(test_file, ["fail"] * 3 + ["pass"])
    for _ in range(2):  # the same rejection twice ends the mechanic's budget
        _implement(
            world,
            "story-483-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const wrong = true;\n"},
        )
    _implement(
        world,
        "story-483-domain",
        "builder",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    state = json.loads((world.home / "runs" / "story-483.json").read_text())
    sessions = {turn["role"]: turn["session"] for turn in state["slices"]["domain"]["turns"]}
    assert sessions["mechanic"] == "story-483-domain/mechanic"
    assert sessions["builder"] == "story-483-domain/builder"
    assert sessions["mechanic"] != sessions["builder"]


def test_an_escalated_role_reusing_the_previous_session_is_a_contract_stop(world):
    _given_planned_story(world, 484)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 484)
    world.scripted_test_outcome(test_file, ["fail"] * 3 + ["pass"])
    for _ in range(2):  # the same rejection twice ends the mechanic's budget
        _implement(
            world,
            "story-484-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const wrong = true;\n"},
        )
    # the builder turn reuses the mechanic's session id
    world.agent_implements(
        "story-484-domain",
        "builder",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        changed_files=["src/lib/delegate.ts"],
        session="story-484-domain/mechanic",
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "reused the previous role's session" in result.stdout
    state = json.loads((world.home / "runs" / "story-484.json").read_text())
    assert state["terminal"] == "AGENT_BROKE_CONTRACT"
    # the rejected escalation turn was settled, not left running
    rejected = state["slices"]["domain"]["turns"][-1]
    assert rejected["status"] == "completed"
    assert rejected["result"] == "failed"
    assert rejected["session"] == "story-484-domain/mechanic"
    assert state["slices"]["domain"]["state"] == "failed"


def test_an_unparsable_reply_stops_implementation_as_a_tool_failure(world):
    _given_planned_story(world, 485)
    _delegate_mechanic(world, 485)
    world.agent_replies_raw("story-485-domain", "mechanic", "this is not json")

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "unparsable reply" in result.stdout
    state = json.loads((world.home / "runs" / "story-485.json").read_text())
    assert state["terminal"] == "TOOL_FAILED"
    assert world.slice_worktree_path("story-485-domain").exists()


def test_a_github_comment_failure_after_the_barrier_is_recorded(world):
    _given_planned_story(world, 486)
    _delegate_mechanic(world, 486)
    _implement(
        world,
        "story-486-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    world.gh_fails_on_comment_body("Implemented: #")

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "implementation succeeded locally but the run failed while reporting" in result.stdout
    state = json.loads((world.home / "runs" / "story-486.json").read_text())
    # the implementation is done and frozen, but the state is not IMPLEMENTED
    assert state["terminal"] == "TOOL_FAILED"
    assert state["slices"]["domain"]["state"] == "succeeded"
    assert state["slices"]["domain"]["frozen_commit"]
    assert world.slice_worktree_path("story-486-domain").exists()


def test_an_unexpected_exception_during_implementation_persists_a_terminal(world):
    _given_planned_story(world, 487)
    _delegate_mechanic(world, 487)
    world.agent_replies_raw("story-487-domain", "mechanic", "still not json")

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    state = json.loads((world.home / "runs" / "story-487.json").read_text())
    assert state["terminal"] == "TOOL_FAILED"


def test_an_unexpected_exception_during_delegation_persists_a_terminal(world):
    _given_planned_story(world, 488)
    world.agent_replies_raw("plan-488", "planner", "not the signals json")

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    state = json.loads((world.home / "runs" / "story-488.json").read_text())
    assert state["terminal"] == "TOOL_FAILED"
    assert "blocked" in world.issue(488)["labels"]


def test_a_non_object_reply_is_a_contract_failure_with_a_settled_turn(world):
    _given_planned_story(world, 489)
    _delegate_mechanic(world, 489)
    # a valid JSON reply that is not an object violates the implementation
    # schema: contract failure, never an attribute error, never TOOL_FAILED
    world.agent_replies_raw("story-489-domain", "mechanic", '["not", "an", "object"]')

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "reply must have exactly changed_files and summary" in result.stdout
    state = json.loads((world.home / "runs" / "story-489.json").read_text())
    assert state["terminal"] == "AGENT_BROKE_CONTRACT"
    assert state["slices"]["domain"]["state"] == "failed"
    rejected = state["slices"]["domain"]["turns"][-1]
    assert rejected["status"] == "completed"
    assert rejected["result"] == "failed"
    assert rejected["session"] == "story-489-domain/mechanic"
    assert "reply must have exactly changed_files and summary" in rejected["why"]


# --- selection precedence reconciliation (issue #377) ----------------------------


def test_a_complete_procedure_without_a_cited_pattern_selects_the_mechanic(world):
    """#377: procedure_complete with technical_choice=none, no uncertainty
    and no sensitive area is mechanic even when no existing pattern was cited."""
    _given_planned_story(world, 404)
    world.planner_answers_delegate(
        404,
        [delegate_slice(404, "domain", mechanic_signals(pattern_known=False))],
    )
    _implement(
        world,
        "story-404-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🎯 #404 (domain) → mechanic · Selection row 4" in result.stdout
    assert "solver" not in "\n".join(_talks(world, "mechanic", "story-404-domain")[0]["prompt"])


def test_an_unknown_pattern_without_a_procedure_still_selects_the_solver(world):
    _given_planned_story(world, 405)
    world.planner_answers_delegate(
        405,
        [
            delegate_slice(
                405, "domain", mechanic_signals(pattern_known=False, procedure_complete=False)
            )
        ],
    )
    _implement(
        world,
        "story-405-domain",
        "solver",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    world.reviewer_answers(405, "merge")

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "no applicable existing pattern is known" in result.stdout
    assert "Selection row 3" in result.stdout


# --- planner corrective loop (issues #375, #378) ---------------------------------


def test_a_malformed_evidence_reference_is_sent_back_to_the_same_planner_session(world):
    _given_planned_story(world, 406)
    broken = delegate_slice(406, "domain", mechanic_signals())
    broken["evidence"][1]["source_ref"] = "run-406/domain/acceptance/97"
    world.planner_answers_delegate(406, [broken])
    world.planner_answers_delegate(406, [delegate_slice(406, "domain", mechanic_signals())])
    _implement(
        world,
        "story-406-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    delegate_calls = delegate_turns(world, 406)
    assert len(delegate_calls) == 2
    correction = delegate_calls[1]["prompt"]
    assert "evidence source_ref does not resolve: 'run-406/domain/acceptance/97'" in correction
    assert "Continue in the same session" in correction
    # session continuity: the planner stayed on its one session id
    sessions = re.findall(r"Session: (\S+)", result.stdout)
    planner_sessions = [session for session in sessions if session.startswith("plan-406")]
    assert sorted(set(planner_sessions)) == ["plan-406/planner"]
    assert "🏁 Implemented #406" in result.stdout


def test_a_corrective_attempt_outside_the_planner_session_stops_the_run(world):
    """#382: continuity between the initial reply and its corrections is
    enforced, not only requested - a backend that answers the corrective
    turn from another session ends the run as an external-tool failure
    instead of grading a fresh conversation as a revised plan."""
    _given_planned_story(world, 409)
    broken = delegate_slice(409, "domain", mechanic_signals())
    broken["evidence"][0]["signal"] = "made_up_signal"
    world.planner_answers_delegate(409, [broken])
    world.planner_answers_delegate(
        409,
        [delegate_slice(409, "domain", mechanic_signals())],
        session="story-409/planner-elsewhere",
    )

    result = run_flow(world)

    assert result.returncode == 26, result.stdout + result.stderr
    assert "planner left its session mid-loop" in result.stdout
    assert "planner-elsewhere" in result.stdout
    assert "ran in 'story-409/planner-elsewhere'" in result.stdout
    assert "❌ TOOL_FAILED (exit 26)" in result.stdout
    assert "planner left its session mid-loop" in world.issue(409)["comments"][-1]
    # the drifted reply was never graded: no slice carries an assignment
    calls = delegate_turns(world, 409)
    assert len(calls) == 2
    assert "🎯 #" not in result.stdout


def test_bounded_choice_with_solution_uncertainty_is_returned_for_repair(world):
    """#383: a valid-shaped reply whose classification contradicts itself
    (the choice is limited, yet the solution is uncertain) is a contract
    rejection with the contradiction as the corrective diagnostic, and a
    consistent retry selects the rung."""
    _given_planned_story(world, 410)
    contradiction = delegate_slice(
        410,
        "domain",
        mechanic_signals(
            solution_uncertain=True, technical_choice="bounded", procedure_complete=False
        ),
    )
    world.planner_answers_delegate(410, [contradiction])
    world.planner_answers_delegate(410, [delegate_slice(410, "domain", mechanic_signals())])
    _implement(
        world,
        "story-410-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    correction = delegate_turns(world, 410)[1]["prompt"]
    assert 'solution_uncertain with technical_choice="bounded"' in correction
    assert "🎯 #410 (domain) → mechanic" in result.stdout
    assert "Selection row 4" in result.stdout


def test_an_unknown_evidence_signal_is_corrected_by_the_bounded_loop(world):
    _given_planned_story(world, 407)
    proposal = delegate_slice(407, "domain", mechanic_signals())
    proposal["evidence"][0]["signal"] = "evidenceNth"
    world.planner_answers_delegate(407, [proposal])
    world.planner_answers_delegate(407, [delegate_slice(407, "domain", mechanic_signals())])
    _implement(
        world,
        "story-407-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    delegate_calls = delegate_turns(world, 407)
    assert len(delegate_calls) == 2
    assert "names unknown signal" in delegate_calls[1]["prompt"]
    assert "🎯 #407 (domain) → mechanic" in result.stdout


def test_planner_contract_rejections_that_survive_the_budget_stop_the_run(world):
    _given_planned_story(world, 408)
    proposal = delegate_slice(408, "domain", mechanic_signals())
    proposal["evidence"][1]["source_ref"] = "run-408/domain/nowhere"
    world.planner_keeps_rejecting(408, [proposal])

    result = run_flow(world)

    assert result.returncode == 27, result.stdout + result.stderr
    planner_calls = [
        call
        for call in _talks(world, "planner", "plan-408")
        if call["argv"][call["argv"].index("--schema") + 1].endswith("delegate.json")
    ]
    assert len(planner_calls) == 3
    assert "Planner exhausted 3 attempts" in result.stdout
    assert "evidence source_ref does not resolve" in result.stdout
    assert "blocked" in world.issue(408)["labels"]
    # the only planning-adjacent worker is block 1's failing-test turn; no
    # implementation worker ever launched
    non_planner = [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call["argv"][0:2] != ["talk", "planner"]
        and call["argv"][0:2] != ["talk", "mechanic"]
    ]
    assert non_planner == []
    assert len(_talks(world, "mechanic", "story-408-domain")) == 1


def test_planner_external_failures_are_never_sent_back_for_contract_repair(world):
    _given_planned_story(world, 409)
    world.planner_fails(409, message="provider offline")

    result = run_flow(world)

    assert result.returncode == 21, result.stdout + result.stderr
    # one signals turn only: whose-call and slices precede it, and the
    # external failure gets no corrective retry
    delegate_calls = [
        call
        for call in _talks(world, "planner", "plan-409")
        if call["argv"][call["argv"].index("--schema") + 1].endswith("delegate.json")
    ]
    assert len(delegate_calls) == 1
    assert "provider offline" in result.stdout
    assert "retry" not in result.stdout
    state = json.loads((world.home / "runs" / "story-409.json").read_text())
    assert state["terminal"] == "AGENT_FAILED"


# --- prohibited changes stay caught across retries (#379) ------------------------


def test_a_prohibited_file_in_a_later_correction_is_rejected_from_the_branch_base(world):
    _given_planned_story(world, 490)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 490)
    # attempt 1 lands but the acceptance test still fails: the loop corrects
    world.scripted_test_outcome(test_file, ["fail", "fail", "pass"])
    world.agent_implements(
        "story-490-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        changed_files=["src/lib/delegate.ts"],
    )
    # the second attempt slips a policy change into the dirty worktree next to
    # the correction; the driver validates the whole delta from the retained
    # failing-test commit at every turn, so hiding it in a retry cannot work.
    # It is told to put the file back and keeps it instead, so the last
    # attempt of the budget is where the run ends.
    for _ in range(2):
        world.agent_implements(
            "story-490-domain",
            "mechanic",
            files={
                "src/lib/delegate.ts": "export const delegate = 2;\n",
                "quality/suppression-baseline.json": '{"maxUnjustified": 8}\n',
            },
            changed_files=["src/lib/delegate.ts", "quality/suppression-baseline.json"],
        )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "forbidden file changed: quality/suppression-baseline.json" in result.stdout
    state = json.loads((world.home / "runs" / "story-490.json").read_text())
    # the rejected turn is failed, not left running: the ledger keeps the why
    assert state["slices"]["domain"]["state"] == "failed"
    rejected = state["slices"]["domain"]["turns"][-1]
    assert rejected["status"] == "completed"
    assert rejected["result"] == "failed"
    assert "forbidden file changed: quality/suppression-baseline.json" in rejected["why"]


def test_prohibited_policy_and_lockfile_changes_stop_the_slice(world):
    """The thresholds, the lockfiles, the CI workflows and the script
    folders that run them are the gates the agent is judged by, and an
    agent that will not put one back ends its run. The driver's own
    `workflow/` code is deliberately not on this list - an agent may
    implement a change to it, and block 4 withholds only the merge."""
    for index, forbidden in enumerate(
        (
            "quality/thresholds.json",
            "bun.lock",
            ".github/workflows/ci.yml",
            "scripts/quality/eslint.ts",
        )
    ):
        story_number = 491 + index
        _given_planned_story(world, story_number)
        _delegate_mechanic(world, story_number)
        for _ in range(3):  # corrected twice, unrepentant, then stopped
            world.agent_implements(
                f"story-{story_number}-domain",
                "mechanic",
                files={
                    "src/lib/delegate.ts": "export const delegate = true;\n",
                    forbidden: "{}\n",
                },
                changed_files=["src/lib/delegate.ts", forbidden],
            )

        result = run_flow(world, story_number)

        assert result.returncode == 22, result.stdout + result.stderr
        assert f"forbidden file changed: {forbidden}" in result.stdout
        state = json.loads((world.home / "runs" / f"story-{story_number}.json").read_text())
        assert state["terminal"] == "AGENT_BROKE_CONTRACT"


# --- block 3 tells a missing implementation from a defective test (issue #399) ---


def test_the_correction_diagnostic_carries_the_failing_test_and_its_message(world):
    _given_planned_story(world, 493)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 493)
    world.scripted_test_outcome(test_file, ["fail", "fail", "pass"])
    _implement(
        world,
        "story-493-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const wrong = true;\n"},
    )
    _implement(
        world,
        "story-493-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "vitest src/lib/delegate.spec.ts still fails" in result.stdout
    # the title and the runner's own message, not just the file name
    assert "the behavior this slice asks for" in result.stdout
    assert "expected undefined to be 42" in result.stdout
    correction_prompt = _talks(world, "mechanic", "story-493-domain")[2]["prompt"]
    assert "the behavior this slice asks for" in correction_prompt
    assert "expected undefined to be 42" in correction_prompt


def test_an_acceptance_test_that_throws_during_implementation_stops_the_run(world):
    _given_planned_story(world, 494)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 494)
    # block 1 saw an honest expectation; the test throws only once the
    # implementation exists, so no implementation can ever make it pass
    world.scripted_test_outcome(test_file, ["fail", "fail_defect"])
    _implement(
        world,
        "story-494-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert "block 1 accepted a defective acceptance test" in result.stdout
    assert "run the story again" in result.stdout
    assert "AGENT_BROKE_CONTRACT" not in result.stdout
    assert "blocked" in world.issue(494)["labels"]
    state = json.loads((world.home / "runs" / "story-494.json").read_text())
    assert state["terminal"] == "TESTS_INVALID"
    # the stop consumed no correction: the one attempt that ran is all there is
    assert state["slices"]["domain"]["attempts"] == 1
    assert state["slices"]["domain"]["diagnostics"] == []
    assert len(_talks(world, "mechanic", "story-494-domain")) == 2


def test_product_code_that_throws_stays_an_ordinary_correction(world):
    _given_planned_story(world, 495)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 495)
    # the same thrown TypeError, but raised inside the product module: that
    # is the implementation's bug and its own correction loop owns it
    world.scripted_test_outcome(
        test_file,
        ["fail", "fail_defect", "pass"],
        message="TypeError: Cannot read properties of undefined (reading 'units')",
        location="src/lib/delegate.ts",
    )
    _implement(
        world,
        "story-495-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const wrong = true;\n"},
    )
    _implement(
        world,
        "story-495-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "block 1 accepted a defective acceptance test" not in result.stdout
    assert "Cannot read properties of undefined (reading 'units')" in result.stdout
    assert "correcting after attempt 1" in result.stdout


# --- a gate failure says where it is, and whose it is (issue #397) --------------


def test_a_failing_duplicates_step_names_both_halves_of_the_clone(world):
    """`verify:changed failed steps: duplicates` cost six attempts on #397
    while jscpd's report on disk named both line ranges. The diagnostic now
    carries them, into the log and into the correction prompt."""
    _given_planned_story(world, 470)
    _delegate_mechanic(world, 470)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    world.given_failed_gate_steps("verify:changed", "duplicates")
    # the clone spans a product file, so the implementer can still repair it
    world.given_duplicate_clone("lib/delegate.ts", "lib/other.ts")
    _implement(
        world,
        "story-470-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-470-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "verify:changed failed steps: duplicates" in result.stdout
    assert "lib/delegate.ts:40-49 ↔ lib/other.ts:90-99 (10 lines)" in result.stdout
    # the detail reads as a block under the headline, not as one long line
    assert "🩺 #470 (domain) diagnostic: verify:changed failed steps: duplicates" in result.stdout
    assert "   │ duplicates:" in result.stdout
    assert "   │   lib/delegate.ts:40-49 ↔ lib/other.ts:90-99 (10 lines)" in result.stdout
    assert "correcting after attempt 1" in result.stdout
    correction = _talks(world, "mechanic", "story-470-domain")[2]["prompt"]
    assert "lib/delegate.ts:40-49 ↔ lib/other.ts:90-99" in correction
    assert "🔒 #470 (domain) frozen at" in result.stdout


def test_a_gate_failure_confined_to_the_acceptance_test_stops_as_tests_invalid(world):
    """The acceptance test's bytes are immutable for an implementation
    turn, so a gate failure only that file could fix is block 1's defect,
    not three corrections and an escalation (#397)."""
    test_file = _given_planned_story(world, 471)
    _delegate_mechanic(world, 471)
    world.given_gate_outcomes(**{"verify:changed": "fail"})
    world.given_failed_gate_steps("verify:changed", "duplicates")
    world.given_duplicate_clone("lib/delegate.spec.ts", "lib/delegate.spec.ts")
    for _ in range(3):
        _implement(
            world,
            "story-471-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert "block 1 accepted an acceptance test the repository gate rejects" in result.stdout
    assert test_file in result.stdout
    assert "lib/delegate.spec.ts:40-49 ↔ lib/delegate.spec.ts:90-99" in result.stdout
    # exactly one implementation turn: no correction, no escalation
    assert len(_talks(world, "mechanic", "story-471-domain")) == 2  # block 1 + block 3
    assert "correcting after attempt 1" not in result.stdout
    assert "blocked" in world.issue(471)["labels"]
    assert any(test_file in comment for comment in world.issue(471)["comments"])


def _given_tests_that_call_a_missing_api(world, number: int) -> str:
    """Block 1 as it now ends for a story that introduces an API: the type
    lane failed inside the acceptance file, the driver accepted it, and the
    slice record carries that debt into block 3."""
    test_file = _given_planned_story(world, number)
    world.given_gate_outcomes(check=["fail", "pass"])
    world.given_type_errors_in([test_file], ["TS2339"])
    return test_file


def test_a_type_error_left_inside_the_acceptance_test_becomes_a_correction(world):
    """Block 1 accepted this file's type errors because the API it calls
    did not exist yet. The same lane still failing on it after an
    implementation turn says the implementation did not provide what the
    tests call - the implementer's own diagnostic, not block 1's defect."""
    test_file = _given_tests_that_call_a_missing_api(world, 474)
    _delegate_mechanic(world, 474)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    world.given_failed_gate_steps("verify:changed", "check")
    world.given_gate_failure_file(test_file)
    _implement(
        world,
        "story-474-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-474-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const toggleSet = (e: number) => e;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "block 1 accepted an acceptance test" not in result.stdout
    assert "the acceptance tests call signatures the implementation does not provide yet" in (
        result.stdout
    )
    assert "Property 'toggleSet' does not exist" in result.stdout
    assert "correcting after attempt 1" in result.stdout
    assert "🔒 #474 (domain) frozen at" in result.stdout


def test_a_clone_inside_an_acceptance_test_still_stops_even_with_recorded_type_debt(world):
    """The exception is exactly the two lanes an implementation answers by
    writing product code. `duplicates` is answered only inside the file it
    names, and that file is immutable here."""
    test_file = _given_tests_that_call_a_missing_api(world, 475)
    _delegate_mechanic(world, 475)
    world.given_gate_outcomes(**{"verify:changed": "fail"})
    world.given_failed_gate_steps("verify:changed", "duplicates")
    world.given_duplicate_clone("lib/delegate.spec.ts", "lib/delegate.spec.ts")
    for _ in range(3):
        _implement(
            world,
            "story-475-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "block 1 accepted an acceptance test the repository gate rejects" in result.stdout
    assert test_file in result.stdout


def test_a_gate_failure_naming_a_product_file_stays_repairable(world):
    """Only a failure confined to the immutable tests stops the run; one
    the implementer's own file caused is an ordinary correction."""
    _given_planned_story(world, 472)
    _delegate_mechanic(world, 472)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    world.given_failed_gate_steps("verify:changed", "format:check")
    world.given_gate_failure_file("src/lib/delegate.ts")
    _implement(
        world,
        "story-472-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-472-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "block 1 accepted an acceptance test" not in result.stdout
    assert "[warn] src/lib/delegate.ts" in result.stdout
    assert "correcting after attempt 1" in result.stdout
    assert "🔒 #472 (domain) frozen at" in result.stdout


def test_a_failing_step_the_driver_cannot_locate_stays_repairable(world):
    """Conservative by construction: a step whose output names no file at
    all says nothing about who owns the failure."""
    _given_planned_story(world, 473)
    _delegate_mechanic(world, 473)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    _implement(
        world,
        "story-473-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-473-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "verify:changed failed steps: test:unit:server" in result.stdout
    assert "rejects an expired token" in result.stdout
    assert "correcting after attempt 1" in result.stdout


# --- a failure the turn only half owns (issue #422) ----------------------------


_NOT_YOURS = "these are block 1's acceptance tests, not yours"


def test_a_mixed_gate_failure_names_block_ones_share_and_stays_repairable(world):
    """A clone with one half in the acceptance test and one in a product
    file is half the implementer's work. It repairs its half, and the same
    diagnostic says the other half is not its to touch - #422's solver was
    handed a spelling error inside a frozen test file beside type errors it
    could have fixed, and was told nothing about the difference."""
    test_file = _given_planned_story(world, 476)
    _delegate_mechanic(world, 476)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    world.given_failed_gate_steps("verify:changed", "duplicates")
    world.given_duplicate_clone("lib/delegate.spec.ts", "lib/delegate.ts")
    _implement(
        world,
        "story-476-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-476-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "block 1 accepted an acceptance test" not in result.stdout
    assert _NOT_YOURS in result.stdout
    assert f"may repair them: {test_file}" in result.stdout
    # the gate's own account of the clone is still there in full
    assert "lib/delegate.spec.ts:40-49 ↔ lib/delegate.ts:90-99 (10 lines)" in result.stdout
    correction = _talks(world, "mechanic", "story-476-domain")[2]["prompt"]
    assert _NOT_YOURS in correction
    assert "correcting after attempt 1" in result.stdout
    assert "🔒 #476 (domain) frozen at" in result.stdout


def test_a_mixed_gate_failure_stops_as_tests_invalid_once_only_block_ones_half_is_left(world):
    """The implementer took its half of the clone out and the acceptance
    test's half is all that still fails. That is the confined failure the
    run stops on - reached in two turns, not by exhausting the budget on
    bytes nobody in block 3 may change."""
    test_file = _given_planned_story(world, 477)
    _delegate_mechanic(world, 477)
    world.given_gate_outcomes(**{"verify:changed": "fail"})
    world.given_failed_gate_steps("verify:changed", "duplicates")
    world.given_duplicate_clone(
        "lib/delegate.spec.ts",
        "lib/delegate.ts",
        then=("lib/delegate.spec.ts", "lib/delegate.spec.ts"),
    )
    _implement(
        world,
        "story-477-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-477-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID (exit 31)" in result.stdout
    assert _NOT_YOURS in result.stdout
    assert "block 1 accepted an acceptance test the repository gate rejects" in result.stdout
    assert f"the failure is confined to {test_file}" in result.stdout
    # one correction, then the stop: no third attempt, no escalation
    assert "correcting after attempt 1" in result.stdout
    assert len(_talks(world, "mechanic", "story-477-domain")) == 3  # block 1 + two block 3 turns
    assert "escalating" not in result.stdout
    assert "blocked" in world.issue(477)["labels"]


def test_a_gate_culprit_outside_the_slices_layer_is_headed_as_off_limits(world):
    """`verify:changed` sizes its steps from the tree, so a domain slice's
    gate can fail inside a UI component the slice may not touch. #422's
    solver was handed six such errors with nothing to distinguish them,
    edited the components, fixed the gate - and was rejected on scope for
    the turn that did it."""
    _given_planned_story(world, 478)
    _delegate_mechanic(world, 478)
    component = "src/lib/components/exercise/SessionExercise.svelte"
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    world.given_failed_gate_steps("verify:changed", "check")
    world.given_gate_failure_file(component)
    _implement(
        world,
        "story-478-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
    )
    _implement(
        world,
        "story-478-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = 2;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    heading = "these files are outside your layer (domain) - do not edit them"
    assert heading in result.stdout
    assert "if the failure is theirs, say so in your summary" in result.stdout
    correction = _talks(world, "mechanic", "story-478-domain")[2]["prompt"]
    assert heading in correction
    # the gate's own line about the file is repeated under the heading
    assert correction.count("Property 'toggleSet' does not exist") == 2
    # naming them changes no verdict: the turn is the ordinary correction
    # it was, and the scope rule is untouched
    assert "outside this slice's reach" not in result.stdout
    assert "correcting after attempt 1" in result.stdout
    assert "🔒 #478 (domain) frozen at" in result.stdout


def test_a_timed_out_acceptance_test_means_the_implementation_is_not_done_yet(world):
    """Block 3 reads the same statuses as block 1: a `toBeVisible` that
    times out is the implementation still missing, not a pass."""
    _given_planned_story(world, 495, layer="ui", test_kind="playwright")
    test_file = "src/routes/delegate.e2e.ts"
    _delegate_mechanic(world, 495, "ui")
    world.scripted_test_outcome(test_file, ["timed_out", "timed_out", "pass"])
    _implement(world, "story-495-ui", "mechanic", files={"src/routes/x/+page.svelte": "<p>a</p>\n"})
    _implement(world, "story-495-ui", "mechanic", files={"src/routes/x/+page.svelte": "<p>b</p>\n"})

    result = run_flow(world)

    assert result.returncode == 0, result.stdout + result.stderr
    still_failing = f"playwright {test_file} still fails, the implementation is not done yet"
    assert still_failing in result.stdout
    assert "correcting after attempt 1" in result.stdout
