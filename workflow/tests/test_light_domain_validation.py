"""End-to-end tests for the temporary lightening of a domain slice's
validation (`fitflow.gates.TEMP_LIGHT_DOMAIN_VALIDATION`).

A domain slice may not touch `src/routes/`, `src/lib/components/` or
`src/lib/ui/`, so its attempts are judged by the repository's `verify:fast`
tier - every static step of the `verify:changed` plan plus the server unit
suite - and the full `verify:changed`, the one that can carry an e2e step
at all, runs once on the accepted attempt before the driver freezes the
slice. A ui slice keeps the full tier on every attempt, and a full-tier
failure at the freeze is an ordinary rejection of that attempt.

Black-box like the other suites: every assertion is on go.py's exit code,
its log, and the commands the fakes recorded.
"""

from conftest import run_flow
from test_delegate_and_implement import (
    _delegate_mechanic,
    _given_planned_story,
    _implement,
)

_LIGHT_TIER_ARGV = ["scripts/quality/gate.ts", "verify:fast"]
_FULL_TIER_ARGV = ["run", "verify:changed"]


def _bun_argvs(world) -> list[list[str]]:
    return [call["argv"] for call in world.calls() if call.get("tool") == "bun"]


def _tier_runs(world) -> list[str]:
    """Every validation tier this run invoked, in order: "light" for the
    whole `verify:fast` tier and "full" for `verify:changed`. Block 1's
    content steps run `gate.ts verify:fast --only ...` and are not a
    validation tier, so they are not counted."""
    runs = []
    for argv in _bun_argvs(world):
        if argv == _LIGHT_TIER_ARGV:
            runs.append("light")
        elif argv == _FULL_TIER_ARGV:
            runs.append("full")
    return runs


def _ready_domain_slice(world, number: int = 1000) -> str:
    slug = f"story-{number}-domain"
    _given_planned_story(world, number)
    _delegate_mechanic(world, number)
    return slug


def test_a_domain_attempt_runs_the_light_tier_and_the_freeze_runs_the_full_one(world):
    slug = _ready_domain_slice(world)
    _implement(world, slug, "mechanic", {"src/lib/delivered.ts": "export const ok = 1;\n"})

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert _tier_runs(world) == ["light", "full"]
    assert (
        "⚡ #1000 (domain) validating on verify:fast, without the e2e suite (temporary); "
        "the full tier runs at freeze" in result.stdout
    )
    assert "running the full verify:changed once before the freeze" in result.stdout
    assert "🔒 #1000 (domain) frozen at" in result.stdout


def test_the_lightening_is_narrated_once_for_the_slice_not_once_per_attempt(world):
    slug = _ready_domain_slice(world)
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    for constant in (1, 2):
        _implement(
            world, slug, "mechanic", {"src/lib/delivered.ts": f"export const ok = {constant};\n"}
        )

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.count("validating on verify:fast, without the e2e suite") == 1


def test_a_full_tier_failure_at_the_freeze_rejects_that_attempt(world):
    """The light tier passes and the full one does not, so the attempt is
    rejected with the gate's own diagnostic and the mechanic corrects it -
    exactly what a `verify:changed` failure has always bought."""
    slug = _ready_domain_slice(world)
    world.given_failed_gate_steps("verify:changed", "lint")
    world.given_gate_failure_file("src/lib/delivered.ts")
    world.given_gate_outcomes(**{"verify:changed": ["fail", "pass"]})
    for constant in (1, 2):
        _implement(
            world, slug, "mechanic", {"src/lib/delivered.ts": f"export const ok = {constant};\n"}
        )

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🩺 #1000 (domain) diagnostic: verify:changed failed steps: lint" in result.stdout
    assert "Mechanic #1000 (domain) correcting after attempt 1" in result.stdout
    assert _tier_runs(world) == ["light", "full", "light", "full"]


def test_a_light_tier_failure_rejects_the_attempt_without_the_full_tier(world):
    """A rejection on the cheap tier is the whole point: the full tier is
    never reached, so the attempt costs what the cheap tier costs."""
    slug = _ready_domain_slice(world)
    world.given_failed_gate_steps("light", "check")
    world.given_gate_failure_file("src/lib/delivered.ts")
    world.given_gate_outcomes(light=["fail", "pass"])
    for constant in (1, 2):
        _implement(
            world, slug, "mechanic", {"src/lib/delivered.ts": f"export const ok = {constant};\n"}
        )

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "🩺 #1000 (domain) diagnostic: verify:fast failed steps: check" in result.stdout
    assert _tier_runs(world) == ["light", "light", "full"]


def test_a_ui_slice_is_judged_by_the_full_tier_on_every_attempt(world):
    """Unchanged: the lightening reaches the domain layer only, and the e2e
    suite a ui diff plans is exactly the proof a ui slice is there for."""
    _given_planned_story(world, 1000, layer="ui", test_kind="playwright")
    _delegate_mechanic(world, 1000, layer="ui")
    _implement(
        world, "story-1000-ui", "mechanic", {"src/routes/delivered.ts": "export const x=1;\n"}
    )

    result = run_flow(world, "1000")

    assert result.returncode == 0, result.stdout + result.stderr
    assert _tier_runs(world) == ["full"]
    assert "⚡ #1000 (ui) validating" not in result.stdout
