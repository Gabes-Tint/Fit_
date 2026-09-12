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
    # implementation stayed local: the branch remote is still the failing-test commit
    remote = subprocess.run(
        ["git", "ls-remote", "origin", "story-400-domain"],
        cwd=world.repo,
        capture_output=True,
        text=True,
    ).stdout.split()[0]
    local = subprocess.run(
        ["git", "rev-parse", "story-400-domain"],
        cwd=world.repo,
        capture_output=True,
        text=True,
    ).stdout.split()[0]
    assert remote != local
    assert "in-progress" in world.issue(400)["labels"]
    assert "blocked" not in world.issue(400)["labels"]


def test_two_corrections_at_the_same_level_then_success(world):
    _given_planned_story(world, 401)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 401)
    world.scripted_test_outcome(test_file, ["fail", "fail", "fail", "pass"])
    _implement(
        world,
        "story-401-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const wrong = true;\n"},
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
    correction_prompt = talks[2]["prompt"]
    assert "rejected attempt 2" in correction_prompt
    assert "vitest src/lib/delegate.spec.ts still fails" in correction_prompt
    assert "🔒 #401 (domain) frozen at" in result.stdout


def test_escalation_uses_the_builder_config_from_yaml(world):
    _given_planned_story(world, 402)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 402)
    world.scripted_test_outcome(test_file, ["fail"] * 4 + ["pass"])
    for _ in range(3):  # mechanic burns its three attempts
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
    assert len(_talks(world, "mechanic", "story-402-domain")) == 4
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
    _given_planned_story(world, 410)
    test_file = "src/lib/delegate.spec.ts"
    _delegate_mechanic(world, 410)
    world.scripted_test_outcome(test_file, ["fail"] * 10)
    for _ in range(3):
        _implement(
            world,
            "story-410-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const wrong = true;\n"},
        )
    for _ in range(3):
        _implement(
            world,
            "story-410-domain",
            "builder",
            files={"src/lib/delegate.ts": "export const wrong2 = true;\n"},
        )
    for _ in range(3):
        _implement(
            world,
            "story-410-domain",
            "solver",
            files={"src/lib/delegate.ts": "export const wrong3 = true;\n"},
        )

    result = run_flow(world)

    assert result.returncode == 28, result.stdout + result.stderr
    assert "solver exhausted its 3 attempts" in result.stdout
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


def test_dependent_slices_are_rejected_before_any_worker_starts(world):
    _given_planned_split(world, 435, ["fail", "pass"], ["fail", "pass"])
    proposals = [
        delegate_slice(435, "domain", mechanic_signals()),
        delegate_slice(435, "ui", mechanic_signals()),
    ]
    proposals[1]["needs_sibling"] = True
    world.planner_keeps_rejecting(435, proposals)

    result = run_flow(world)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "cannot be implemented and validated independently" in result.stdout
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


def test_touching_workflow_or_gate_files_is_a_contract_stop(world):
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

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "forbidden file changed: quality/" in result.stdout


def test_lying_about_changed_files_is_a_contract_stop(world):
    _given_planned_story(world, 442)
    _delegate_mechanic(world, 442)
    world.agent_implements(
        "story-442-domain",
        "mechanic",
        files={"src/lib/delegate.ts": "export const delegate = true;\n"},
        changed_files=["src/lib/never-touched.ts"],
        summary="did nothing real",
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "reported files do not match the actual diff" in result.stdout
    # both divergence sides, reported and real, are named together (#382)
    assert "unreported src/lib/delegate.ts; phantom src/lib/never-touched.ts" in result.stdout


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
    assert state["terminal"] == "DELIVERED"
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
    _implement(
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


def test_a_ui_slice_cannot_implement_domain_files(world):
    _given_planned_story(world, 465, layer="ui", test_kind="playwright")
    world.planner_answers_delegate(465, [delegate_slice(465, "ui", mechanic_signals())])
    _implement(
        world,
        "story-465-ui",
        "mechanic",
        files={"src/lib/domain/banner.ts": "export const banner = true;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "ui slice changed a domain file outside its scope" in result.stdout


def test_a_domain_slice_cannot_implement_svelte_files(world):
    _given_planned_story(world, 466)
    _delegate_mechanic(world, 466)
    _implement(
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
    _implement(
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
    _implement(
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
    _implement(
        world,
        "story-471-ui",
        "mechanic",
        files={"src/lib/state/store.svelte.ts": "export const x = 1;\n"},
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "ui slice changed the shared store outside its scope" in result.stdout


def test_an_underreported_file_list_is_a_contract_stop(world):
    _given_planned_story(world, 467)
    _delegate_mechanic(world, 467)
    world.agent_implements(
        "story-467-domain",
        "mechanic",
        files={
            "src/lib/delegate.ts": "export const delegate = true;\n",
            "src/lib/helper.ts": "export const helper = 1;\n",
        },
        changed_files=["src/lib/delegate.ts"],
        summary="forgot to report one file",
    )

    result = run_flow(world)

    assert result.returncode == 22, result.stdout + result.stderr
    assert "unreported src/lib/helper.ts" in result.stdout
    # with nothing phantom, the message names only the unreported side (#382)
    assert "phantom" not in result.stdout


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
    # block 1 ran to completion; the interrupted state stopped delegation
    # before any implementation worker launched
    assert len(_talks(world, "mechanic", "story-468-domain")) == 1


# --- third review round: sessions, layer boundaries, truthful terminals ----------


def test_corrections_reuse_the_same_recorded_session(world):
    _given_planned_story(world, 480)
    _delegate_mechanic(world, 480)
    world.scripted_test_outcome("src/lib/delegate.spec.ts", ["fail", "fail", "fail", "pass"])
    for _ in range(3):
        _implement(
            world,
            "story-480-domain",
            "mechanic",
            files={"src/lib/delegate.ts": "export const wrong = true;\n"},
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
    world.scripted_test_outcome(test_file, ["fail"] * 4 + ["pass"])
    for _ in range(3):  # mechanic burns its three attempts
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
    world.scripted_test_outcome(test_file, ["fail"] * 4 + ["pass"])
    for _ in range(3):  # mechanic burns its three attempts
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
    # failing-test commit at every turn, so hiding it in a retry cannot work
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


def test_prohibited_policy_workflow_and_lockfile_changes_stop_the_slice(world):
    for index, forbidden in enumerate(
        (
            "quality/thresholds.json",
            "bun.lock",
            "workflow/go.py",
            "scripts/quality/eslint.ts",
        )
    ):
        story_number = 491 + index
        _given_planned_story(world, story_number)
        _delegate_mechanic(world, story_number)
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
