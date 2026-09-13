"""End-to-end tests for a UI slice that depends on its domain sibling.

Block 2 accepts `needs_sibling` on the `ui` slice of a two-slice story, and
block 3 then runs the domain loop first, merges its frozen commit into the
UI branch and launches the UI loop on that merge. Black-box like the other
suites: every assertion is on go.py's exit code, its log, the retained
record and the fake world.
"""

import subprocess

from conftest import (
    delegate_slice,
    mechanic_signals,
    run_flow,
)

DOMAIN_TEST = "src/lib/split.spec.ts"
UI_TEST = "src/routes/split.e2e.ts"
DOMAIN_SLUG = "story-1000-domain"
UI_SLUG = "story-1001-ui"


def _given_planned_split(
    world, number: int, domain_outcomes: list[str], ui_outcomes: list[str]
) -> None:
    """Block 1 for a two-layer story: children #1000 (domain) and #1001
    (ui), both with failing acceptance tests written, validated and
    pushed."""
    world.given_story(number, title="Dependent split", labels=["story"])
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
                "brief": "Search results carry the brand and the labelled serving.",
                "acceptance": ["A search result carries its brand."],
                "test_kind": "vitest",
            },
            {
                "layer": "ui",
                "title": "UI half",
                "brief": "Rows show the brand and the labelled serving.",
                "acceptance": ["A result row shows the brand at 360px."],
                "test_kind": "playwright",
            },
        ],
    )
    world.mechanic_writes(DOMAIN_SLUG, files={DOMAIN_TEST: "// failing\n"}, test_files=[DOMAIN_TEST])
    world.mechanic_writes(UI_SLUG, files={UI_TEST: "// failing\n"}, test_files=[UI_TEST])
    world.scripted_test_outcome(DOMAIN_TEST, domain_outcomes)
    world.scripted_test_outcome(UI_TEST, ui_outcomes)


def _dependent_plan(world, number: int) -> None:
    """The planner's block 2 answer: the UI slice cannot be implemented and
    validated before the domain slice exists."""
    proposals = [
        delegate_slice(number, "domain", mechanic_signals()),
        delegate_slice(number, "ui", mechanic_signals()),
    ]
    proposals[1]["needs_sibling"] = True
    world.planner_answers_delegate(number, proposals)


def _implement(world, slug: str, files: dict[str, str]) -> None:
    world.agent_implements(slug, "mechanic", files=files, changed_files=sorted(files))


def _talks(world, team: str) -> list[dict]:
    return [
        call
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "mechanic"]
        and call["argv"][call["argv"].index("--team") + 1] == team
    ]


def _turn_events(world) -> list[tuple[str, str]]:
    """Every mechanic turn's start and end, in the order the fake world saw
    them: ("start"|"finish", team)."""
    events = []
    for call in world.calls():
        argv = call.get("argv", [])
        if call.get("tool") == "aarmy" and argv[0:2] == ["talk", "mechanic"]:
            events.append(("start", argv[argv.index("--team") + 1]))
        elif call.get("event") == "agent_finished" and call.get("role") == "mechanic":
            events.append(("finish", call["team"]))
    return events


def _parents(world, sha: str) -> list[str]:
    result = subprocess.run(
        ["git", "rev-list", "--parents", "-n", "1", sha],
        cwd=world.repo,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.split()[1:]


# --- the dependent UI slice runs after the domain slice -------------------------


def test_a_dependent_ui_slice_runs_after_the_domain_slice_freezes(world):
    # one more "fail" than an independent slice needs: the driver re-checks
    # the UI acceptance tests on the merged tree before launching its loop
    _given_planned_split(world, 450, ["fail", "pass"], ["fail", "fail", "pass"])
    _dependent_plan(world, 450)
    _implement(world, DOMAIN_SLUG, {"src/lib/split.ts": "export const brand = true;\n"})
    _implement(world, UI_SLUG, {"src/routes/split-page.ts": "export const row = true;\n"})

    result = run_flow(world, 450)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "⛓️ #1001 (ui) waits for #1000 (domain)" in result.stdout
    assert "⚡ Starting 2 implementation loops in parallel" not in result.stdout
    # the domain implementation turn ended before the UI one was launched
    events = _turn_events(world)
    domain_finishes = [i for i, event in enumerate(events) if event == ("finish", DOMAIN_SLUG)]
    ui_starts = [i for i, event in enumerate(events) if event == ("start", UI_SLUG)]
    assert len(domain_finishes) == 2 and len(ui_starts) == 2  # block 1, then block 3
    assert domain_finishes[1] < ui_starts[1]

    state = world.run_record(450)
    domain, ui = state["slices"]["domain"], state["slices"]["ui"]
    assert ui["depends_on"] == "domain"
    assert ui["sibling_merged"] == domain["frozen_commit"]
    # the UI turn ran on a driver-made merge commit, and that merge is what
    # every later check compares against; the tests stay at block 1's commit
    assert ui["failing_sha"] != ui["tests_sha"]
    assert _parents(world, ui["failing_sha"]) == [ui["tests_sha"], domain["frozen_commit"]]
    assert domain["tests_sha"] == domain["failing_sha"]
    # the merge was pushed, so the pre-turn checks against origin still hold
    assert f"⇪ Pushed {UI_SLUG} at {ui['failing_sha'][:12]}" in result.stdout
    assert world.pull(500)["state"] == "MERGED"


def test_a_failed_domain_slice_never_launches_the_ui_slice(world):
    _given_planned_split(world, 451, ["fail"] * 12, ["fail", "fail", "pass"])
    _dependent_plan(world, 451)
    for role in ("mechanic", "builder", "solver"):
        for _ in range(3):
            world.agent_implements(
                DOMAIN_SLUG,
                role,
                files={"src/lib/split.ts": "export const wrong = true;\n"},
                changed_files=["src/lib/split.ts"],
            )

    result = run_flow(world, 451)

    assert result.returncode == 28, result.stdout + result.stderr
    assert "❌ #1000 (domain): CAPACITY_EXHAUSTED" in result.stdout
    assert "⛓️ #1001 (ui) not launched: waits for #1000 (domain)" in result.stdout
    assert len(_talks(world, UI_SLUG)) == 1  # block 1's test-writing turn only
    ui = world.run_record(451)["slices"]["ui"]
    assert ui["state"] == "assigned"
    assert ui["sibling_merged"] == ""
    assert ui["failing_sha"] == ui["tests_sha"]


def test_ui_acceptance_that_the_domain_slice_alone_satisfies_stops_the_run(world):
    _given_planned_split(world, 452, ["fail", "pass"], ["fail", "pass"])
    _dependent_plan(world, 452)
    _implement(world, DOMAIN_SLUG, {"src/lib/split.ts": "export const brand = true;\n"})

    result = run_flow(world, 452)

    assert result.returncode == 24, result.stdout + result.stderr
    assert "the domain slice alone satisfies the ui acceptance tests" in result.stdout
    assert len(_talks(world, UI_SLUG)) == 1  # no UI implementation turn was launched
    assert "blocked" in world.issue(452)["labels"]


def test_resume_brings_in_the_domain_slice_fixed_after_the_first_run_stopped(world):
    _given_planned_split(world, 453, ["fail", "pass"], ["fail", "fail", "pass"])
    _dependent_plan(world, 453)
    _implement(world, DOMAIN_SLUG, {"src/lib/split.ts": "export const brand = true;\n"})
    _implement(world, UI_SLUG, {"src/routes/split-page.ts": "export const row = true;\n"})
    world.given_gate_outcomes(**{"verify:changed": "tool_error"})

    stopped = run_flow(world, 453)

    assert stopped.returncode == 26, stopped.stdout + stopped.stderr
    assert "⛓️ #1001 (ui) not launched: waits for #1000 (domain)" in stopped.stdout
    assert len(_talks(world, UI_SLUG)) == 1

    world.given_gate_outcomes(**{"verify:changed": "pass"})
    result = run_flow(world, 453, "--resume")

    assert result.returncode == 0, result.stdout + result.stderr
    # the domain turn was re-validated from its retained reply, and only then
    # was its frozen commit merged into the UI branch
    assert len(_talks(world, DOMAIN_SLUG)) == 2  # block 1 and the first run's turn
    assert len(_talks(world, UI_SLUG)) == 2  # block 1, then the turn this run launched
    assert "⛓️ Bringing #1000 (domain)" in result.stdout
    state = world.run_record(453)
    domain, ui = state["slices"]["domain"], state["slices"]["ui"]
    assert ui["sibling_merged"] == domain["frozen_commit"]
    assert _parents(world, ui["failing_sha"]) == [ui["tests_sha"], domain["frozen_commit"]]


def test_two_slices_depending_on_each_other_are_rejected(world):
    _given_planned_split(world, 454, ["fail", "pass"], ["fail", "pass"])
    proposals = [
        delegate_slice(454, "domain", mechanic_signals()),
        delegate_slice(454, "ui", mechanic_signals()),
    ]
    proposals[0]["needs_sibling"] = True
    proposals[1]["needs_sibling"] = True
    world.planner_keeps_rejecting(454, proposals)

    result = run_flow(world, 454)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "every slice depends on its sibling" in result.stdout
    assert _talks(world, DOMAIN_SLUG) and len(_talks(world, UI_SLUG)) == 1
