"""End-to-end tests for the additive domain slice and the ui slice that
adopts its API.

#422 planned a domain slice that changed exported signatures the UI calls
and briefed it to "Update existing callers so the app still compiles" -
callers under `src/routes/`, which a domain slice may never touch. Every
attempt was either out of scope or left the tree not compiling. Block 2 now
names those exports, the driver keeps the domain slice additive, and the ui
slice that runs after it adopts the new API at the call sites.

Black-box like the other suites: every assertion is on go.py's exit code,
its log, the prompts the fake `aarmy` saw, the retained record and the fake
world afterwards.
"""

from conftest import delegate_slice, mechanic_signals, run_flow

DOMAIN_TEST = "src/lib/tend.spec.ts"
UI_TEST = "src/routes/tend.e2e.ts"
DOMAIN_SLUG = "story-1000-domain"
UI_SLUG = "story-1001-ui"

DOMAIN_BRIEF = "toggleSet takes the exercise index explicitly."
UI_BRIEF = "The tend page passes the exercise index to every set control."


def _slice(layer: str, brief: str, exports: list[str] | None = None) -> dict:
    return {
        "layer": layer,
        "title": f"{layer.capitalize()} half",
        "brief": brief,
        "acceptance": [f"The {layer} behavior is observable."],
        "test_kind": "vitest" if layer == "domain" else "playwright",
        "ui_called_exports": list(exports or []),
    }


def _given_story(world, number: int) -> None:
    world.given_story(number, title="Tend by index", labels=["story"])
    world.planner_answers_whose_call(
        number,
        owner="orchestrator",
        category="none",
        reason="ordinary work",
        question="",
        options=[],
        recommendation="",
    )


def _given_block_one(world, domain_outcomes: list[str], ui_outcomes: list[str]) -> None:
    """The failing acceptance tests of both children, written and pushed."""
    world.mechanic_writes(
        DOMAIN_SLUG, files={DOMAIN_TEST: "// failing\n"}, test_files=[DOMAIN_TEST]
    )
    world.mechanic_writes(UI_SLUG, files={UI_TEST: "// failing\n"}, test_files=[UI_TEST])
    world.scripted_test_outcome(DOMAIN_TEST, domain_outcomes)
    world.scripted_test_outcome(UI_TEST, ui_outcomes)


def _given_additive_split(world, number: int, ui_outcomes: list[str] | None = None) -> None:
    """Block 1 for the shape #422 needed: a domain slice whose changed
    export the UI calls, and the ui slice that adopts it."""
    _given_story(world, number)
    world.planner_answers_slices(
        number,
        spans_domain_and_ui=True,
        slices=[_slice("domain", DOMAIN_BRIEF, ["toggleSet"]), _slice("ui", UI_BRIEF)],
    )
    # one more "fail" than an independent slice needs: the driver re-checks
    # the UI acceptance tests on the merged tree before launching its loop
    _given_block_one(world, ["fail", "pass"], ui_outcomes or ["fail", "fail", "pass"])


def _independent_plan(world, number: int) -> None:
    """The planner's block 2 answer, with neither slice claiming to need
    its sibling: the dependency of an additive story is the driver's."""
    world.planner_answers_delegate(
        number,
        [
            delegate_slice(number, "domain", mechanic_signals()),
            delegate_slice(number, "ui", mechanic_signals()),
        ],
    )


def _implement(world, slug: str, files: dict[str, str]) -> None:
    world.agent_implements(slug, "mechanic", files=files, changed_files=sorted(files))


def _prompts(world, role: str, team: str) -> list[str]:
    return [
        call["prompt"]
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", role]
        and call["argv"][call["argv"].index("--team") + 1] == team
    ]


def _slicing_prompts(world, number: int) -> list[str]:
    return [
        call["prompt"]
        for call in world.calls()
        if call.get("tool") == "aarmy"
        and call.get("argv", [None, None])[0:2] == ["talk", "planner"]
        and call["argv"][call["argv"].index("--team") + 1] == f"plan-{number}"
        and call["argv"][call["argv"].index("--schema") + 1].endswith("slices.json")
    ]


# --- the plan: additive domain, dependent ui --------------------------------------


def test_a_domain_export_the_ui_calls_makes_its_slice_additive(world):
    _given_additive_split(world, 480)
    _independent_plan(world, 480)
    _implement(world, DOMAIN_SLUG, {"src/lib/state/tend.svelte.ts": "export const set = 1;\n"})
    _implement(world, UI_SLUG, {"src/routes/tend/+page.ts": "export const page = 1;\n"})

    result = run_flow(world, 480)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🧩 Domain slice stays additive: toggleSet are called from the UI" in result.stdout
    domain = world.run_record(480)["slices"]["domain"]
    assert domain["ui_called_exports"] == ["toggleSet"]
    # the additive clause is the driver's own words on the child issue, so
    # block 1 and block 3 both read it wherever they read the brief
    assert "Additive API:" in world.issue(1000)["body"]
    assert "Do not touch the callers." in world.issue(1000)["body"]
    assert "Adopt and clean up:" in world.issue(1001)["body"]


def test_the_ui_slice_of_an_additive_story_runs_after_the_domain_slice(world):
    """The planner said neither slice needs its sibling. Adopting the new
    API means editing the files the domain slice just changed, so the
    dependency is the driver's decision, not the planner's."""
    _given_additive_split(world, 481)
    _independent_plan(world, 481)
    _implement(world, DOMAIN_SLUG, {"src/lib/state/tend.svelte.ts": "export const set = 1;\n"})
    _implement(world, UI_SLUG, {"src/routes/tend/+page.ts": "export const page = 1;\n"})

    result = run_flow(world, 481)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "⛓️ #1001 (ui) depends on the domain slice and runs after it" in result.stdout
    assert "it adopts the additive API of toggleSet" in result.stdout
    assert "⚡ Starting 2 implementation loops in parallel" not in result.stdout
    state = world.run_record(481)
    assert state["slices"]["ui"]["depends_on"] == "domain"
    assert state["slices"]["ui"]["sibling_merged"] == state["slices"]["domain"]["frozen_commit"]


def test_each_implementer_is_told_which_side_of_the_new_api_is_its_own(world):
    _given_additive_split(world, 482)
    _independent_plan(world, 482)
    _implement(world, DOMAIN_SLUG, {"src/lib/state/tend.svelte.ts": "export const set = 1;\n"})
    _implement(world, UI_SLUG, {"src/routes/tend/+page.ts": "export const page = 1;\n"})

    result = run_flow(world, 482)

    assert result.returncode == 0, result.stdout + result.stderr
    domain_turn = _prompts(world, "mechanic", DOMAIN_SLUG)[-1]
    assert "`toggleSet` are called from `src/routes/`" in domain_turn
    assert "Keep every existing call working" in domain_turn
    ui_turn = _prompts(world, "mechanic", UI_SLUG)[-1]
    assert "already carries its domain sibling" in ui_turn
    assert "`src/lib/state/` are inside its reach" in ui_turn


# --- a brief may never ask for a file its layer forbids ---------------------------


def test_a_domain_brief_that_updates_its_callers_goes_back_to_the_same_planner(world):
    """#422's brief, verbatim. The domain slice cannot touch the callers and
    block 1's tests demand the new signature, so no implementation could
    satisfy both; the planner is asked for a brief that can be obeyed."""
    _given_story(world, 483)
    world.planner_answers_slices(
        483,
        spans_domain_and_ui=True,
        slices=[
            _slice("domain", "Update existing callers so the app still compiles.", ["toggleSet"]),
            _slice("ui", UI_BRIEF),
        ],
    )
    world.planner_answers_slices(
        483,
        spans_domain_and_ui=True,
        slices=[_slice("domain", DOMAIN_BRIEF, ["toggleSet"]), _slice("ui", UI_BRIEF)],
    )
    _given_block_one(world, ["fail", "pass"], ["fail", "fail", "pass"])
    _independent_plan(world, 483)
    _implement(world, DOMAIN_SLUG, {"src/lib/state/tend.svelte.ts": "export const set = 1;\n"})
    _implement(world, UI_SLUG, {"src/routes/tend/+page.ts": "export const page = 1;\n"})

    result = run_flow(world, 483)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🔁 Brief sent back to the same planner session after attempt 1:" in result.stdout
    assert 'the domain brief says "Update existing callers"' in result.stdout
    prompts = _slicing_prompts(world, 483)
    assert len(prompts) == 2
    assert "correct the rejected slicing reply" in prompts[1]
    assert "Update existing callers" in prompts[1]


def test_a_ui_brief_that_names_the_store_goes_back_to_the_same_planner(world):
    _given_story(world, 484)
    world.planner_answers_slices(
        484,
        spans_domain_and_ui=True,
        slices=[
            _slice("domain", DOMAIN_BRIEF),
            _slice("ui", "Read the sets from src/lib/state/tend.svelte.ts."),
        ],
    )
    world.planner_answers_slices(
        484,
        spans_domain_and_ui=True,
        slices=[_slice("domain", DOMAIN_BRIEF), _slice("ui", UI_BRIEF)],
    )
    _given_block_one(world, ["fail", "pass"], ["fail", "pass"])
    _independent_plan(world, 484)
    _implement(world, DOMAIN_SLUG, {"src/lib/domain/tend.ts": "export const set = 1;\n"})
    _implement(world, UI_SLUG, {"src/routes/tend/+page.ts": "export const page = 1;\n"})

    result = run_flow(world, 484)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "the ui brief names src/lib/state/, which a ui slice may not change" in result.stdout
    assert len(_slicing_prompts(world, 484)) == 2


def test_a_ui_slice_that_claims_exports_the_ui_calls_goes_back_to_the_same_planner(world):
    """Only a domain slice ever changes an export the UI calls; the field is
    what makes that slice additive, and it means nothing on the ui slice."""
    _given_story(world, 485)
    world.planner_answers_slices(
        485,
        spans_domain_and_ui=True,
        slices=[_slice("domain", DOMAIN_BRIEF), _slice("ui", UI_BRIEF, ["toggleSet"])],
    )
    world.planner_answers_slices(
        485,
        spans_domain_and_ui=True,
        slices=[_slice("domain", DOMAIN_BRIEF), _slice("ui", UI_BRIEF)],
    )
    _given_block_one(world, ["fail", "pass"], ["fail", "pass"])
    _independent_plan(world, 485)
    _implement(world, DOMAIN_SLUG, {"src/lib/domain/tend.ts": "export const set = 1;\n"})
    _implement(world, UI_SLUG, {"src/routes/tend/+page.ts": "export const page = 1;\n"})

    result = run_flow(world, 485)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "the ui slice lists ui_called_exports" in result.stdout


def test_briefs_that_keep_contradicting_their_layer_stop_the_run(world):
    _given_story(world, 486)
    for _ in range(3):
        world.planner_answers_slices(
            486,
            spans_domain_and_ui=True,
            slices=[
                _slice("domain", "Update the existing callers under src/routes/.", ["toggleSet"]),
                _slice("ui", UI_BRIEF),
            ],
        )

    result = run_flow(world, 486)

    assert result.returncode == 27, result.stdout + result.stderr
    assert "🛑 Planner exhausted 3 attempts" in result.stdout
    assert "kept contradicting their own layers" in result.stdout
    assert len(_slicing_prompts(world, 486)) == 3
    assert "blocked" in world.issue(486)["labels"]
    # no child issue was created for a plan that was never accepted
    assert "✏️  Created #" not in result.stdout


# --- the dependent ui slice's widened scope ---------------------------------------


def test_a_dependent_ui_slice_may_adopt_the_new_api_where_it_is_called(world):
    """The call sites of an additive domain export live in the store and the
    domain modules, so switching them to the new API and removing the old
    shape is the dependent ui slice's own work, not a scope breach."""
    _given_additive_split(world, 487)
    _independent_plan(world, 487)
    _implement(world, DOMAIN_SLUG, {"src/lib/state/tend.svelte.ts": "export const set = 1;\n"})
    _implement(
        world,
        UI_SLUG,
        {
            "src/routes/tend/+page.svelte": "<p>tend</p>\n",
            "src/lib/state/tend.svelte.ts": "export const set = 2;\n",
            "src/lib/domain/tend.ts": "export const tally = 1;\n",
        },
    )

    result = run_flow(world, 487)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "outside its scope" not in result.stdout
    assert "🔒 #1001 (ui) frozen at" in result.stdout


def test_a_ui_slice_with_no_domain_sibling_to_adopt_still_breaches_on_the_store(world):
    """The widening belongs to the dependency, not to the ui layer: a ui
    slice that runs beside its domain sibling is judged exactly as before."""
    _given_story(world, 488)
    world.planner_answers_slices(
        488,
        spans_domain_and_ui=True,
        slices=[_slice("domain", DOMAIN_BRIEF), _slice("ui", UI_BRIEF)],
    )
    _given_block_one(world, ["fail", "pass"], ["fail", "pass"])
    _independent_plan(world, 488)
    _implement(world, DOMAIN_SLUG, {"src/lib/domain/tend.ts": "export const set = 1;\n"})
    for _ in range(2):
        _implement(
            world,
            UI_SLUG,
            {
                "src/routes/tend/+page.svelte": "<p>tend</p>\n",
                "src/lib/state/tend.svelte.ts": "export const set = 2;\n",
            },
        )

    result = run_flow(world, 488)

    assert result.returncode == 22, result.stdout + result.stderr
    assert (
        "ui slice changed the shared store outside its scope: src/lib/state/tend.svelte.ts"
        in result.stdout
    )


def test_a_workflow_brief_may_name_the_product_paths_its_rule_is_about(world):
    """A driver story is routinely about a product path - where an `.e2e.ts`
    belongs - and naming one is description, not an instruction to change
    it. The workflow slice's allowlist scope check still judges the diff."""
    test_file = "workflow/tests/test_placement.py"
    world.given_story(489, title="Placement rule", labels=["story"])
    world.planner_answers_whose_call(
        489,
        owner="orchestrator",
        category="none",
        reason="ordinary driver work",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        489,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "workflow",
                "title": "Placement rule",
                "brief": "Block 1 rejects an .e2e.ts outside src/routes/.",
                "acceptance": ["A misplaced e2e file is rejected."],
                "test_kind": "pytest",
                "ui_called_exports": [],
            }
        ],
    )
    world.given_pytest_results(test_file, ["fail", "pass"])
    world.mechanic_writes(
        "story-489-workflow",
        files={test_file: "def test_placement():\n    assert False\n"},
        test_files=[test_file],
    )
    world.planner_answers_delegate(489, [delegate_slice(489, "workflow", mechanic_signals())])
    world.agent_implements(
        "story-489-workflow",
        "mechanic",
        files={"workflow/fitflow/placement.py": "RULE = 'src/routes/'\n"},
        changed_files=["workflow/fitflow/placement.py"],
    )

    result = run_flow(world, 489)

    # a driver story ends at block 4's withheld merge, not at a rejected plan
    assert result.returncode == 11, result.stdout + result.stderr
    assert "Brief sent back to the same planner session" not in result.stdout
