"""End-to-end tests for the third slice layer: a story whose code is the
driver itself.

Such a story used to die in block 1. The planner could only choose `domain`
or `ui`, both of which live under `src/`; block 1 recognised only vitest and
playwright files as tests, so a pushed `workflow/tests/test_*.py` came back
as "non-test file changed"; and the gates it ran - `lint:changed`, `check`
and the repository gate's content steps - only know TypeScript. #406 spent
three mechanic attempts on a diagnostic no mechanic could act on.

The `workflow` layer closes that: pytest runs the acceptance tests, ruff and
the markdown pair are the gates, and block 4 still hands the merge to
Gabriel exactly as it does for any pull request that changes the driver.
"""

import json

from conftest import GABRIEL_LOGIN, delegate_slice, mechanic_signals, run_flow

TEST_FILE = "workflow/tests/test_retry_ladder.py"
FAILING_TEST = "def test_both_helpers_read_one_ladder():\n    assert False\n"
LADDER = "workflow/fitflow/retries.py"


def _given_planned_driver_story(world, number: int = 1000) -> str:
    """Block 1 for a driver story: one workflow slice, one pytest acceptance
    file that fails now and passes once the implementation lands."""
    world.given_story(number, title="Share the retry ladder", labels=["story"])
    world.planner_answers_whose_call(
        number,
        owner="orchestrator",
        category="none",
        reason="ordinary maintainability work on the driver",
        question="",
        options=[],
        recommendation="",
    )
    world.planner_answers_slices(
        number,
        spans_domain_and_ui=False,
        slices=[
            {
                "layer": "workflow",
                "title": "One retry ladder",
                "brief": "Both transient-retry helpers read the same ladder.",
                "acceptance": ["Both helpers read one ladder."],
                "test_kind": "pytest",
            }
        ],
    )
    world.given_pytest_results(TEST_FILE, ["fail", "pass"])
    return f"story-{number}-workflow"


def _mechanic_pushes_tests(world, slug: str, attempt: object = 1, **kwargs) -> None:
    """One block 1 turn. `attempt` only varies the bytes: a retry that
    rewrote the file identically would have nothing to commit. `role`
    reaches `mechanic_writes` for the rungs above the mechanic."""
    body = f"# attempt {attempt}\n{FAILING_TEST}"
    world.mechanic_writes(slug, files={TEST_FILE: body}, test_files=[TEST_FILE], **kwargs)


def _delegate(world, number: int) -> None:
    world.planner_answers_delegate(number, [delegate_slice(number, "workflow", mechanic_signals())])


def _implement(world, slug: str, files: dict[str, str]) -> None:
    world.agent_implements(slug, "mechanic", files=files, changed_files=sorted(files))


def _pr(world, number: int) -> dict:
    """The fake gh's PR record, read from disk: the run happened in other
    processes, so the fixture's in-memory world is stale."""
    return json.loads((world.dir / "world.json").read_text()).get("prs", {}).get(str(number), {})


def test_a_story_about_the_driver_runs_every_block_and_stops_at_the_merge(world):
    slug = _given_planned_driver_story(world)
    _mechanic_pushes_tests(world, slug)
    _delegate(world, 1000)
    _implement(world, slug, {LADDER: "LADDER = (1, 2, 4)\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    # block 1 accepted the pytest file and judged it with the driver's gates
    assert "🧪 Gates: ruff check ✔" in result.stdout
    assert "🧪 Gates: ruff format ✔" in result.stdout
    assert f"🧪 {TEST_FILE} → failed, as it should ✔" in result.stdout
    assert "only tests ✔ · ruff check ✔ · ruff format ✔" in result.stdout
    # blocks 2 and 3 ran the slice as a `workflow` one throughout
    assert "🎯 #1000 (workflow) → mechanic" in result.stdout
    assert "📦 Validating #1000 (workflow)" in result.stdout
    assert "🏁 Implemented #1000 → #1000 workflow (mechanic," in result.stdout
    # block 4 opened the PR, CI went green, and only the merge was withheld
    assert "changes the driver" in result.stdout
    assert _pr(world, 500)["state"] == "OPEN"
    assert "needs-gabriel" in world.issue(1000)["labels"]
    assert GABRIEL_LOGIN in world.issue(1000)["assignees"]
    state = json.loads((world.home / "runs" / "story-1000.json").read_text())
    assert state["delivery"]["held_for_gabriel"] == [LADDER, TEST_FILE]
    assert state["terminal"] == "NEEDS_GABRIEL"


def test_the_bun_gates_never_run_for_a_driver_story(world):
    """`verify:changed`, `lint:changed` and `check` size and run the
    repository's TypeScript, so they have nothing to say about Python and
    prose. The driver's own four stand in their place, in both blocks."""
    slug = _given_planned_driver_story(world)
    _mechanic_pushes_tests(world, slug)
    _delegate(world, 1000)
    _implement(world, slug, {LADDER: "LADDER = (1, 2, 4)\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    bun_gates = [
        " ".join(call["argv"])
        for call in world.calls()
        if call.get("tool") == "bun" and call["argv"][:1] in (["run"], ["scripts/quality/gate.ts"])
    ]
    assert not [argv for argv in bun_gates if "verify" in argv or "lint" in argv]
    assert "🧪 Gates: verify:changed" not in result.stdout


def test_block_one_may_change_a_fake_and_a_conftest_but_not_the_driver_itself(world):
    """Everything under `workflow/tests/` is test-side: a new flow scenario
    needs its `given_*` helper and often a scripted answer in a fake. A
    driver module is not, and comes back as an ordinary correction."""
    slug = _given_planned_driver_story(world)
    world.mechanic_writes(
        slug,
        files={TEST_FILE: FAILING_TEST, LADDER: "LADDER = ()\n"},
        test_files=[TEST_FILE],
    )
    world.mechanic_writes(
        slug,
        files={
            TEST_FILE: FAILING_TEST,
            "workflow/tests/conftest.py": "# given_retry_ladder\n",
            "workflow/tests/fakes/uv": "# scripted pytest answers\n",
        },
        test_files=[TEST_FILE],
        delete=[LADDER],
    )
    _delegate(world, 1000)
    _implement(world, slug, {LADDER: "LADDER = (1, 2, 4)\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    assert f"TESTS_NOT_PUSHED: non-test file changed on {slug}: {LADDER}" in result.stdout
    assert "🔁 Mechanic #1000 retrying after attempt 1" in result.stdout
    assert "🏁 Implemented #1000" in result.stdout


def test_a_mechanic_that_reports_a_conftest_as_an_acceptance_test_is_corrected(world):
    """pytest collects no test from `conftest.py`, so it can never be the
    file block 1 proves fails. Changing it is fine; naming it is not."""
    slug = _given_planned_driver_story(world)
    world.mechanic_writes(
        slug,
        files={TEST_FILE: FAILING_TEST, "workflow/tests/conftest.py": "# helper\n"},
        test_files=["workflow/tests/conftest.py"],
    )
    _mechanic_pushes_tests(world, slug, attempt=2, delete=["workflow/tests/conftest.py"])
    _delegate(world, 1000)
    _implement(world, slug, {LADDER: "LADDER = (1, 2, 4)\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    assert "reported workflow/tests/conftest.py as an acceptance test" in result.stdout
    assert "🏁 Implemented #1000" in result.stdout


def test_ruff_on_the_tests_branch_hands_its_own_diagnostic_to_the_mechanic(world):
    slug = _given_planned_driver_story(world)
    _mechanic_pushes_tests(world, slug, attempt=1)
    _mechanic_pushes_tests(world, slug, attempt=2)
    world.given_ruff_failure(TEST_FILE, outcome=["fail", "pass"])
    # block 1 runs every check on every attempt, the acceptance run
    # included, so the rejected attempt consumes a pytest run of its own
    world.given_pytest_results(TEST_FILE, ["fail", "fail", "pass"])
    _delegate(world, 1000)
    _implement(world, slug, {LADDER: "LADDER = (1, 2, 4)\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    assert "TESTS_INVALID: ruff check failed" in result.stdout
    # the mechanic is told the rule, the file and the line, not just a name
    assert "F401 [*] `os` imported but unused" in result.stdout
    assert f"--> {TEST_FILE}:7:8" in result.stdout
    assert "🔁 Mechanic #1000 retrying after attempt 1" in result.stdout
    assert "🏁 Implemented #1000" in result.stdout


def test_tests_that_never_satisfy_ruff_stop_the_mechanic_early(world):
    """A gate that keeps failing the same way is not waiting for another
    reply. The third attempt is prepared and deliberately not spent, and the
    run still stops as TESTS_INVALID."""
    slug = _given_planned_driver_story(world)
    for attempt in (1, 2, 3):
        _mechanic_pushes_tests(world, slug, attempt=attempt)
    # block 1 escalates a rung when a role's budget ends with the tests
    # still rejected (#437), so the ladder above the mechanic is scripted
    # too and only the solver's exhaustion stops the run
    for index, role in enumerate(("builder", "builder", "solver", "solver"), start=4):
        _mechanic_pushes_tests(world, slug, attempt=index, role=role)
    world.given_ruff_failure(TEST_FILE, gate="ruff format")
    # the tests keep failing as they should; only the gate is wrong, so
    # every attempt collects the identical diagnostic
    world.given_pytest_results(TEST_FILE, "fail")

    result = run_flow(world, "1000")

    assert result.returncode == 31, result.stdout + result.stderr
    assert "TESTS_INVALID: ruff format failed" in result.stdout
    assert "🛑 Mechanic #1000 stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "1 of 3 attempts went unspent" in result.stdout
    assert "🛑 Solver #1000 stopped early: attempt 2 failed exactly as attempt 1" in result.stdout
    assert "Stopped: TESTS_INVALID" in "\n".join(world.issue(1000)["comments"])


def test_a_pytest_collection_error_is_not_a_test_failing_as_intended(world):
    """A module pytest could not import never ran an assertion, so it is not
    a test waiting for the behavior - it is a broken test, and the mechanic
    gets the exception behind it."""
    slug = _given_planned_driver_story(world)
    world.given_pytest_results(TEST_FILE, ["collect_error", "fail", "pass"])
    _mechanic_pushes_tests(world, slug, attempt=1)
    _mechanic_pushes_tests(world, slug, attempt=2)
    _delegate(world, 1000)
    _implement(world, slug, {LADDER: "LADDER = (1, 2, 4)\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    assert f"TESTS_DO_NOT_FAIL: pytest could not collect {TEST_FILE}" in result.stdout
    assert "ModuleNotFoundError: No module named 'fitflow.retries'" in result.stdout
    assert "a collection or import error is not a test failing" in result.stdout
    assert "🏁 Implemented #1000" in result.stdout


def test_a_workflow_slice_that_touches_the_product_is_corrected_then_stops_the_run(world):
    """The product is outside a driver slice's reach. The implementer gets
    the file back for a correction, and keeping it there through a second,
    identical rejection breaks the contract - the third attempt would only
    reproduce it, so it is never spent."""
    slug = _given_planned_driver_story(world)
    _mechanic_pushes_tests(world, slug)
    _delegate(world, 1000)
    for _ in range(3):
        _implement(
            world,
            slug,
            {LADDER: "LADDER = (1, 2, 4)\n", "src/lib/retries.ts": "export const n = 1;\n"},
        )

    result = run_flow(world, "1000")

    assert result.returncode == 22, result.stdout + result.stderr
    assert "workflow slice changed a file outside the driver: src/lib/retries.ts" in result.stdout
    assert "may change only workflow/**, docs/** and cspell.json" in result.stdout
    assert "those paths are outside this slice's reach" in result.stdout
    state = json.loads((world.home / "runs" / "story-1000.json").read_text())
    assert state["terminal"] == "AGENT_BROKE_CONTRACT"
    assert "1 of 3 attempts went unspent" in result.stdout
    assert state["slices"]["workflow"]["attempts"] == 2


def test_a_workflow_slice_that_puts_the_product_file_back_carries_on(world):
    slug = _given_planned_driver_story(world)
    _mechanic_pushes_tests(world, slug)
    _delegate(world, 1000)
    _implement(
        world,
        slug,
        {LADDER: "LADDER = (1, 2, 4)\n", "src/lib/retries.ts": "export const n = 1;\n"},
    )
    world.agent_implements(
        slug,
        "mechanic",
        files={},
        delete=["src/lib/retries.ts"],
        changed_files=[LADDER],
        summary="put the product file back; the driver slice does not need it",
    )

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    assert "workflow slice changed a file outside the driver: src/lib/retries.ts" in result.stdout
    assert "correcting after attempt 1" in result.stdout
    assert "🏁 Implemented #1000" in result.stdout


def test_changed_markdown_faces_prettier_and_cspell_and_a_miss_is_repaired(world):
    slug = _given_planned_driver_story(world)
    _mechanic_pushes_tests(world, slug)
    _delegate(world, 1000)
    world.given_markdown_failure("workflow/README.md", gate="cspell", outcome=["fail", "pass"])
    _implement(world, slug, {LADDER: "LADDER = ()\n", "workflow/README.md": "# driver\n"})
    _implement(world, slug, {LADDER: "LADDER = (1, 2, 4)\n", "workflow/README.md": "# driver\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    assert "cspell failed:" in result.stdout
    assert "workflow/README.md:12:5 - Unknown word (fitflow)" in result.stdout
    assert "🧪 Gates: prettier ✔" in result.stdout
    assert "🧪 Gates: cspell ✔" in result.stdout


def test_a_driver_story_may_add_a_word_to_the_spell_check_dictionary(world):
    """`cspell.json` is a gate file every other slice is forbidden, and the
    prose that needs the word travels with it."""
    slug = _given_planned_driver_story(world)
    _mechanic_pushes_tests(world, slug)
    _delegate(world, 1000)
    _implement(
        world,
        slug,
        {
            LADDER: "LADDER = (1, 2, 4)\n",
            "workflow/README.md": "# fitflow\n",
            "cspell.json": '{ "words": ["fitflow"] }\n',
        },
    )

    result = run_flow(world, "1000")

    assert result.returncode == 11, result.stdout + result.stderr
    assert "forbidden file changed" not in result.stdout
    assert "🏁 Implemented #1000" in result.stdout
