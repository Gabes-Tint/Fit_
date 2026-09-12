"""End-to-end configuration checks through the go.py process boundary."""

from pathlib import Path

import pytest
from conftest import (
    delegate_slice,
    mechanic_signals,
    run_flow,
)


def _given_runnable_story(world, number: int) -> None:
    world.given_story(number, title="Configured agents", labels=["story"])
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
                "title": "Configured agents",
                "brief": "Write the acceptance test.",
                "acceptance": ["The test fails."],
                "test_kind": "vitest",
            }
        ],
    )
    test_file = "src/lib/configured.spec.ts"
    world.mechanic_writes(
        f"story-{number}-domain", files={test_file: "// failing\n"}, test_files=[test_file]
    )
    world.scripted_test_outcome(test_file, ["fail", "pass"])
    world.planner_answers_delegate(number, [delegate_slice(number, "domain", mechanic_signals())])
    world.agent_implements(
        f"story-{number}-domain",
        "mechanic",
        files={"src/lib/configured.ts": "export const configured = true;\n"},
        changed_files=["src/lib/configured.ts"],
    )


def _option(argv: list[str], name: str) -> str:
    return argv[argv.index(name) + 1]


def test_config_is_cwd_independent_and_reaches_both_agent_roles(world):
    world.given_agent_config(
        """planner:
  backend: claude
  model: opus-test
  effort: high
mechanic:
  backend: opencode
  model: provider/model-test
  effort: custom-variant
builder:
  backend: grok
  model: provider/builder-test
  effort: another-variant
solver:
  backend: codex
  model: provider/solver-test
  effort: solver-variant
"""
    )
    _given_runnable_story(world, 200)

    result = run_flow(world, "200", cwd=world.dir)

    assert result.returncode == 0, result.stdout + result.stderr
    turns = [call for call in world.calls() if call.get("tool") == "aarmy"]
    planner = next(call for call in turns if call["argv"][1] == "planner")
    mechanic = next(call for call in turns if call["argv"][1] == "mechanic")
    assert (
        _option(planner["argv"], "-b"),
        _option(planner["argv"], "-m"),
        _option(planner["argv"], "-e"),
    ) == (
        "claude",
        "opus-test",
        "high",
    )
    assert (
        _option(mechanic["argv"], "-b"),
        _option(mechanic["argv"], "-m"),
        _option(mechanic["argv"], "-e"),
    ) == ("opencode", "provider/model-test", "custom-variant")


def test_default_config_is_resolved_beside_go_not_from_cwd(world):
    _given_runnable_story(world, 201)

    result = run_flow(world, "201", cwd=world.dir, use_default_config=True)

    assert result.returncode == 0, result.stdout + result.stderr
    turns = [call for call in world.calls() if call.get("tool") == "aarmy"]
    planner = next(call for call in turns if call["argv"][1] == "planner")
    mechanic = next(call for call in turns if call["argv"][1] == "mechanic")
    assert (
        _option(planner["argv"], "-b"),
        _option(planner["argv"], "-m"),
        _option(planner["argv"], "-e"),
    ) == ("claude", "haiku", "low")
    assert (
        _option(mechanic["argv"], "-b"),
        _option(mechanic["argv"], "-m"),
        _option(mechanic["argv"], "-e"),
    ) == ("claude", "haiku", "low")


@pytest.mark.parametrize(
    "config,diagnostic",
    [
        ("[]\n", "top level must be a mapping"),
        (
            "planner: {backend: claude, model: opus, effort: medium}\n",
            "missing roles: builder, mechanic, solver",
        ),
        (
            """planner: {backend: claude, model: opus, effort: medium}
mechanic: {backend: claude, model: haiku, effort: low}
reviewer: {backend: claude, model: opus, effort: high}
""",
            "extra roles: reviewer",
        ),
        (
            """planner: {backend: claude, model: opus}
mechanic: {backend: claude, model: haiku, effort: low}
builder: {backend: claude, model: sonnet, effort: medium}
solver: {backend: claude, model: opus, effort: high}
""",
            "missing keys: effort",
        ),
        (
            """planner: {backend: claude, model: opus, effort: medium, timeout: 1}
mechanic: {backend: claude, model: haiku, effort: low}
builder: {backend: claude, model: sonnet, effort: medium}
solver: {backend: claude, model: opus, effort: high}
""",
            "extra keys: timeout",
        ),
        (
            """planner: {backend: claude, model: 7, effort: medium}
mechanic: {backend: claude, model: haiku, effort: low}
builder: {backend: claude, model: sonnet, effort: medium}
solver: {backend: claude, model: opus, effort: high}
""",
            "planner.model must be a non-empty string",
        ),
        (
            """planner: {backend: claude, model: '', effort: medium}
mechanic: {backend: claude, model: haiku, effort: low}
builder: {backend: claude, model: sonnet, effort: medium}
solver: {backend: claude, model: opus, effort: high}
""",
            "planner.model must be a non-empty string",
        ),
        (
            """planner: {backend: unknown, model: opus, effort: medium}
mechanic: {backend: claude, model: haiku, effort: low}
builder: {backend: claude, model: sonnet, effort: medium}
solver: {backend: claude, model: opus, effort: high}
""",
            "backend must be one of claude, codex, grok, opencode",
        ),
        (
            """planner: {backend: claude, model: opus, effort: extreme}
mechanic: {backend: claude, model: haiku, effort: low}
builder: {backend: claude, model: sonnet, effort: medium}
solver: {backend: claude, model: opus, effort: high}
""",
            "effort for backend claude must be one of high, low, max, medium, xhigh",
        ),
        ("planner: [\n", "invalid YAML"),
    ],
)
def test_invalid_config_stops_before_any_external_action(world, config, diagnostic):
    world.given_agent_config(config)

    result = run_flow(world)

    assert result.returncode == 2
    assert diagnostic in result.stderr
    assert world.calls() == []


def test_missing_config_stops_before_any_external_action(world):
    missing = Path(world.dir) / "missing-agents.yaml"

    result = run_flow(world, config_path=missing)

    assert result.returncode == 2
    assert "configuration error: cannot read" in result.stderr
    assert str(missing) in result.stderr
    assert world.calls() == []
