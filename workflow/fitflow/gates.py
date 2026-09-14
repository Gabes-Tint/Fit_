"""The turn gates: `bun run verify:changed` and, for block 1's
acceptance-test branch, `bun run lint:changed`, `bun run check` and the
repository gate's own content steps - the repository's own gates.

`run_turn_gates` runs one command in the slice worktree that sizes and runs
everything the turn's actual diff needs — the static checks, the specs that
import or sit beside the changed files, the route e2e files, every applicable
mutation lane and the bundle/build triggers — using the repository's
dependency and route mapping from `scripts/quality/verify-changed-plan.ts`.
The driver adds no derivation of its own, so its view can never drift from
the repo's.

`run_changed_lint`, `run_type_check` and `run_failing_branch_steps` cover
block 1: acceptance tests become immutable implementation inputs, so they
must pass their own change-scoped lint, the repository's type lane and the
repository gate's content steps (`duplicates`, `format:check`,
`check:suppressions`, `spellcheck`) before the branch is accepted, and the
mechanic gets the diagnostic. Those four steps judge bytes rather than
behavior, so they give the same verdict in block 1 as they will in block 3
- where the test file is immutable and nobody is allowed to repair it
(#397). `spellcheck` joined them after #422: a mechanic wrote
`it('untogles a set ...')`, block 1 never looked, and the solver met an
unknown word in a file it was forbidden to edit - and a dictionary,
`cspell.json`, that only a workflow slice may touch.

The two lanes return a `LaneFailure`, which carries the same output parsed
error by error (`fitflow.lanes`) beside the diagnostic. Block 1 needs that
finer reading because a story introducing a new API produces type and
type-aware lint errors inside the acceptance file by construction, and
those are part of failing as intended; everything else is still a
rejection.

Verdicts come from the gate's own report
(`reports/quality/gate-verify-changed.json`), never from a missing one:
exit 0 with a fresh `ok` report passes; exit 1 with named failed steps is a
repairable diagnostic; a crash (exit 97), a missing, stale or unparsable
report, or a report contradicting the exit code is an external tool
failure that stops the run — never an implementation verdict, never a
success. No full local CI tier is implied.

`run_workflow_gates` covers the third layer. A slice whose code is the
driver itself changes Python and prose, which none of the bun lanes size or
run, so ruff, ruff format and - over changed markdown - prettier and cspell
take their place, in block 1 and in every block 3 turn alike.

A judged failure carries the detail, not just the step names: the gate
report points at each failed step's captured log, and `duplicates` also
leaves a jscpd report naming both halves of every clone. Block 3 spent six
attempts on "verify:changed failed steps: duplicates" while the report on
disk said which two line ranges of which file (#397), so the diagnostic now
says it.
"""

import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from fitflow import lanes
from fitflow.outcome import FlowFailure, Outcome

_CRASH_EXIT_CODE = 97
_REPORT = Path("reports") / "quality" / "gate-verify-changed.json"
_FAILING_BRANCH_REPORT = Path("reports") / "quality" / "gate-verify-fast.json"
_JSCPD_REPORT = Path("reports") / "quality" / "duplication" / "jscpd-report.json"

#: The repository gate's non-test steps: they judge the bytes of a file, so
#: their verdict on the failing-test branch is the verdict block 3 will get
#: on the same, by then immutable, bytes. `verify:changed` runs the whole
#: tier including the tests that must still fail here, so block 1 selects
#: these three through the gate's own `--only`.
FAILING_BRANCH_STEPS = ("duplicates", "format:check", "check:suppressions", "spellcheck")
_FAILING_BRANCH_ARGV = [
    "bun",
    "scripts/quality/gate.ts",
    "verify:fast",
    "--only",
    ",".join(FAILING_BRANCH_STEPS),
]

_DETAIL_LINES = 12
_DETAIL_CHARS = 1200
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

#: cspell's own issue line: the file, the position, then the word it did
#: not know. Both the repository's `spellcheck` step and a workflow slice's
#: markdown pass print it.
_CSPELL_ISSUE = re.compile(r"^([\w./@+-]+):\d+:\d+ - ")

#: How each step names the files it blames. A step that is not here, or
#: whose output names nothing, leaves the failure unlocated: the driver then
#: draws no conclusion about who owns it.
_CULPRIT_PATTERNS = {
    "format:check": re.compile(r"^\[warn\]\s+(\S+)\s*$"),
    "check:suppressions": re.compile(r"^\s+(\S+):\d+\s"),
    "spellcheck": _CSPELL_ISSUE,
    "lint": re.compile(r"^([\w./@+-]+\.(?:ts|js|mjs|cjs|svelte|json|md|css|html))\s*$"),
    "lint:changed": re.compile(r"^([\w./@+-]+\.(?:ts|js|mjs|cjs|svelte|json|md|css|html))\s*$"),
}

#: The type lane names its files inside its diagnostics rather than on a
#: line of their own, so `lanes.type_errors` reads them out instead of a
#: pattern. Block 3 needs them located for the same reason every other step
#: does: to know whether a failure is confined to the acceptance tests.
_TYPE_STEPS = ("check",)


@dataclass(frozen=True)
class GateFailure:
    """One judged (exit 1) gate run.

    `diagnostic` is what the agent is told, detail included. `culprits` are
    the files the failed steps named, and `located` says whether every
    failed step named some: when it is false nothing may be concluded from
    `culprits`, because a step whose output the driver cannot read could be
    blaming anything. `steps` are the failed step names, which say what kind
    of verdict this was.
    """

    diagnostic: str
    culprits: frozenset[str]
    located: bool
    steps: frozenset[str] = frozenset()

    @property
    def headline(self) -> str:
        return self.diagnostic.splitlines()[0] if self.diagnostic else ""


@dataclass(frozen=True)
class LaneFailure:
    """One judged (exit 1) run of a single-command lane - `lint:changed` or
    `check`. `diagnostic` is what the mechanic is told; `reading` is the
    same output parsed error by error, for the block 1 checks that must ask
    which errors those were rather than only that there were some."""

    diagnostic: str
    reading: lanes.LaneReading


def run_changed_lint(worktree: Path, story_number: int) -> "LaneFailure | None":
    """Run the repository's change-scoped lint in the slice worktree and
    return a repairable failure, or None when it passes. Block 1 runs it
    over the failing-test branch: acceptance tests become immutable inputs,
    so tests whose own lint is broken are never accepted. Exit 1 with lint
    output is a repairable diagnostic; any other exit is an external tool
    failure, never a lint verdict."""
    result = _launch(["bun", "run", "lint:changed"], worktree, story_number, "lint:changed")
    # both streams can carry real diagnostics: eslint prints the error body
    # to stdout in some configurations and to stderr in others, so neither
    # stream alone may be the verdict (#382)
    output = _both_streams(result)
    if result.returncode == 0:
        narrate_gates(0, "lint:changed")
        return None
    if result.returncode == 1:
        return LaneFailure(
            f"lint:changed failed on the acceptance tests: {output[-800:]}",
            lanes.lint_errors(output),
        )
    raise FlowFailure(
        Outcome.TOOL_FAILED,
        f"lint:changed crashed (exit {result.returncode}): {output[-800:]}",
        story_number,
        add_blocked=True,
    )


def run_type_check(worktree: Path, story_number: int) -> "LaneFailure | None":
    """Run the repository's own type lane (`bun run check`: `svelte-kit sync`
    then `svelte-check` against `tsconfig.json`) over the failing-test branch
    and return a repairable failure, or None when it passes.

    `check` is a static step of both CI and `verify:changed`, so main is green
    on it by construction and this branch adds only test files: a type error
    here is the acceptance tests'. Exit 1 with the checker's output is a
    repairable diagnostic; any other exit is an external tool failure."""
    result = _launch(["bun", "run", "check"], worktree, story_number, "check")
    output = _both_streams(result)
    if result.returncode == 0:
        narrate_gates(0, "check")
        return None
    if result.returncode == 1:
        return LaneFailure(
            f"check found type errors in the acceptance tests: {output[-800:]}",
            lanes.type_errors(output),
        )
    raise FlowFailure(
        Outcome.TOOL_FAILED,
        f"check crashed (exit {result.returncode}): {output[-800:]}",
        story_number,
        add_blocked=True,
    )


def _both_streams(result: subprocess.CompletedProcess) -> str:
    return "\n".join(stream.strip() for stream in (result.stderr, result.stdout) if stream.strip())


def run_failing_branch_steps(worktree: Path, story_number: int) -> "GateFailure | None":
    """Run the repository gate's content steps over the failing-test branch
    and return a repairable failure, or None when they pass.

    These are the steps block 3 will run over the very same test bytes, by
    which time they are immutable and no implementer may repair them: a
    clone inside an acceptance test failed `duplicates` on six consecutive
    implementation attempts before anyone could see where it was (#397).
    The mechanic still owns the file here, so the same verdict is an
    ordinary block 1 correction."""
    started = time.time()
    label = ", ".join(FAILING_BRANCH_STEPS)
    result = _launch(_FAILING_BRANCH_ARGV, worktree, story_number, label)
    return _verdict(worktree, story_number, started, result, label, _FAILING_BRANCH_REPORT)


def run_turn_gates(worktree: Path, story_number: int) -> "GateFailure | None":
    """Run the pre-push gate for this turn's diff. Returns a repairable
    failure, or None when the gate passed.

    A crashed run (any exit outside {0, 1}) is retried once before it is
    judged an external tool failure - the same single re-run QUALITY.md
    prescribes to a human reading a crashed lane - because a fresh
    worktree's first mutation run can lose a transient Vite/ProjectReader
    race."""
    for attempt in (1, 2):
        started = time.time()
        result = _launch(["bun", "run", "verify:changed"], worktree, story_number, "verify:changed")
        if result.returncode not in (0, 1) and attempt == 1:
            from fitflow import narrate

            narrate.line(f"🔁 verify:changed crashed (exit {result.returncode}); retrying once")
            continue
        return _verdict(worktree, story_number, started, result, "verify:changed", _REPORT)
    raise AssertionError("unreachable: the loop returns on attempt 2")


def _launch(
    argv: list[str], worktree: Path, story_number: int, label: str
) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(argv, cwd=worktree, capture_output=True, text=True)
    except OSError as error:
        raise FlowFailure(
            Outcome.TOOL_FAILED, f"{label} could not run: {error}", story_number
        ) from error


def _verdict(
    worktree: Path,
    story_number: int,
    started: float,
    result: subprocess.CompletedProcess,
    label: str,
    report_name: Path,
) -> "GateFailure | None":
    report_path = worktree / report_name
    report = _fresh_report(report_path, started, story_number, label)
    failed = report.get("failed") or []
    crashed = report.get("crashed") or []
    if result.returncode == 0:
        if report.get("ok") is not True or failed or crashed:
            raise FlowFailure(
                Outcome.TOOL_FAILED,
                f"{label} report contradicts its green exit: {report_path}",
                story_number,
                add_blocked=True,
            )
        narrate_gates(int(report.get("stepsRun", 0) or 0), label)
        return None
    if result.returncode == 1 and failed and not crashed:
        return _failure(worktree, report, failed, label)
    raise FlowFailure(
        Outcome.TOOL_FAILED,
        f"{label} crashed (exit {result.returncode}); "
        f"failed={failed}, crashed={crashed} — see {report_path}",
        story_number,
        add_blocked=True,
    )


def _fresh_report(report_path: Path, started: float, story_number: int, label: str) -> dict:
    """The gate report must exist, be written by this turn, and parse. A
    missing, stale or unparsable report is never treated as a failed
    assertion and never as success."""
    if not report_path.exists():
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"{label} left no gate report at {report_path}",
            story_number,
            add_blocked=True,
        )
    if report_path.stat().st_mtime < started:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"{label} gate report is stale (predates this turn): {report_path}",
            story_number,
            add_blocked=True,
        )
    return _parsed(report_path, story_number, label)


def _parsed(report_path: Path, story_number: int, label: str) -> dict:
    try:
        report = json.loads(report_path.read_text())
    except (ValueError, OSError) as error:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"{label} gate report is unparsable: {error}",
            story_number,
            add_blocked=True,
        ) from error
    if (
        not isinstance(report, dict)
        or not isinstance(report.get("failed"), list)
        or not isinstance(report.get("crashed"), list)
    ):
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"{label} gate report has an unexpected shape: {report_path}",
            story_number,
            add_blocked=True,
        )
    return report


# --- the detail a failed step carries ------------------------------------


def _failure(worktree: Path, report: dict, failed: list[str], label: str) -> GateFailure:
    """Turn the report's failed steps into the diagnostic the agent reads:
    the step names first, then each step's own account of what it found."""
    entries = _step_entries(report)
    lines = [f"{label} failed steps: {', '.join(failed)}"]
    culprits: set[str] = set()
    located = True
    for name in failed:
        detail, blamed = _step_failure(worktree, entries.get(name) or {"name": name})
        lines.append(f"{name}:")
        lines.extend(f"  {text}" for text in detail or ["(the step left no readable output)"])
        if blamed is None:
            located = False
        else:
            culprits |= blamed
    return GateFailure(
        "\n".join(lines), frozenset(culprits), located and bool(culprits), frozenset(failed)
    )


def _step_entries(report: dict) -> dict:
    steps = report.get("steps")
    return {
        step.get("name"): step
        for step in (steps if isinstance(steps, list) else [])
        if isinstance(step, dict)
    }


def _step_failure(worktree: Path, step: dict) -> tuple[list[str], frozenset[str] | None]:
    """One failed step's compact detail, and the files it blames - or None
    for the files when the driver cannot read them out reliably. Culprits
    come from the whole output, never from the truncated detail: a tail that
    happens to stop before a product file must not read as a failure
    confined to the tests."""
    if step.get("name") == "duplicates":
        clones = _clone_report(worktree)
        if clones:
            return [_clone_line(clone) for clone in clones], _clone_files(clones)
    output = _step_output(worktree, step)
    return _tail(output), _blamed_files(step.get("name"), output)


def _step_output(worktree: Path, step: dict) -> str:
    """A step's captured output. `gate.ts` and `verify-changed.ts` write it
    to the log the report points at; inline `detail`/`stderr`/`stdout` are
    read too, so a report shape that carries the text itself still works."""
    inline = [
        str(step[key]).strip()
        for key in ("detail", "stderr", "stdout")
        if str(step.get(key) or "").strip()
    ]
    if inline:
        return "\n".join(inline)
    log = step.get("log")
    if not isinstance(log, str) or not log:
        return ""
    try:
        return (worktree / log).read_text()
    except OSError:
        return ""


def _tail(output: str) -> list[str]:
    """The last few meaningful lines, ANSI stripped and length capped: a
    gate log is thousands of lines of table and the verdict is at the end."""
    return _clip(_meaningful(output)[-_DETAIL_LINES:], drop_first=True)


def _head(output: str) -> list[str]:
    """The first few meaningful lines, for a tool that lists its findings
    from the top and ends with a count - ruff, prettier and cspell all do.
    Their tail is the end of the last finding and says least of all."""
    return _clip(_meaningful(output)[:_DETAIL_LINES], drop_first=False)


def _meaningful(output: str) -> list[str]:
    return [
        text
        for text in (_ANSI.sub("", raw).rstrip() for raw in output.splitlines())
        if text.strip()
    ]


def _clip(lines: list[str], drop_first: bool) -> list[str]:
    while lines and sum(len(text) + 1 for text in lines) > _DETAIL_CHARS:
        if len(lines) == 1:
            return [lines[0][:_DETAIL_CHARS]]
        lines.pop(0 if drop_first else -1)
    return lines


def _blamed_files(name: object, output: str) -> frozenset[str] | None:
    if name in _TYPE_STEPS:
        reading = lanes.type_errors(output)
        return frozenset(error.file for error in reading.errors) if reading.complete else None
    pattern = _CULPRIT_PATTERNS.get(name) if isinstance(name, str) else None
    if pattern is None:
        return None
    found = {
        match.group(1) for line in output.splitlines() if (match := pattern.match(line)) is not None
    }
    return frozenset(found) or None


def _clone_report(worktree: Path) -> list[dict]:
    """jscpd's own report, which names both halves of every clone. The
    `duplicates` step prints a table around them; the report is exact."""
    try:
        report = json.loads((worktree / _JSCPD_REPORT).read_text())
    except (ValueError, OSError):
        return []
    clones = report.get("duplicates") if isinstance(report, dict) else None
    if not isinstance(clones, list):
        return []
    return [clone for clone in clones[:_DETAIL_LINES] if _clone_sides(clone) is not None]


def _clone_sides(clone: object) -> tuple[dict, dict] | None:
    if not isinstance(clone, dict):
        return None
    first, second = clone.get("firstFile"), clone.get("secondFile")
    if not isinstance(first, dict) or not isinstance(second, dict):
        return None
    if not isinstance(first.get("name"), str) or not isinstance(second.get("name"), str):
        return None
    return first, second


def _clone_line(clone: dict) -> str:
    sides = _clone_sides(clone)
    if sides is None:
        return ""
    lines = clone.get("lines")
    count = f" ({lines} lines)" if isinstance(lines, int) else ""
    return f"{_side(sides[0])} ↔ {_side(sides[1])}{count}"


def _side(entry: dict) -> str:
    return f"{entry['name']}:{entry.get('start')}-{entry.get('end')}"


def _clone_files(clones: list[dict]) -> frozenset[str]:
    names: set[str] = set()
    for clone in clones:
        sides = _clone_sides(clone)
        if sides is not None:
            names |= {sides[0]["name"], sides[1]["name"]}
    return frozenset(names)


# --- the driver's own gates ----------------------------------------------
#
# A workflow slice changes Python and prose, so `verify:changed`,
# `lint:changed` and `check` have nothing to say about it: they size and run
# the repository's TypeScript. These four run in their place, in both block 1
# and block 3, and they are the same four CI's "Workflow driver" job runs
# plus the repository's markdown pair. Each names the files and lines it
# rejects, so the failure comes back located and block 3 can tell a gate that
# blames only the acceptance tests from one that blames the implementation.

_RUFF = ["uv", "run", "--project", "workflow", "ruff"]
#: ruff points at a file with an arrow line under the rule; older releases
#: put `path:line:col:` at the start of the diagnostic instead.
_RUFF_ARROW = re.compile(r"^\s*-->\s+([\w./@+-]+\.py):\d+:\d+\s*$")
_RUFF_INLINE = re.compile(r"^([\w./@+-]+\.py):\d+:\d+:\s")
_PRETTIER_WARN = _CULPRIT_PATTERNS["format:check"]

#: Where a workflow slice's prose lives. The markdown pair runs only over
#: the files the turn actually changed, the way `lint:changed` does.
_MARKDOWN_ROOTS = ("workflow/", "docs/")


def run_workflow_gates(
    worktree: Path, story_number: int, changed: list[str]
) -> "GateFailure | None":
    """Run the driver's own gates over a workflow slice's tree and return a
    repairable failure, or None when they pass.

    Exit 1 is the verdict; any other exit is an external tool failure that
    stops the run, never an implementation verdict - the same rule the bun
    gates follow."""
    for label, argv, patterns in _workflow_steps(changed):
        failure = _external_step(worktree, story_number, label, argv, patterns)
        if failure is not None:
            return failure
        narrate_gates(0, label)
    return None


def workflow_gate_names(changed: list[str]) -> tuple[str, ...]:
    """The gates a workflow turn actually runs, in order. The markdown pair
    is scoped to the files the turn changed, so it is absent from a turn
    that changed no prose - and the narration must not claim it ran."""
    return tuple(label for label, _argv, _patterns in _workflow_steps(changed))


def changed_markdown(changed: list[str]) -> list[str]:
    return sorted(
        name for name in changed if name.endswith(".md") and name.startswith(_MARKDOWN_ROOTS)
    )


def _workflow_steps(changed: list[str]) -> list[tuple[str, list[str], tuple[re.Pattern, ...]]]:
    steps = [
        ("ruff check", [*_RUFF, "check", "workflow"], (_RUFF_ARROW, _RUFF_INLINE)),
        ("ruff format", [*_RUFF, "format", "--check", "workflow"], (_RUFF_ARROW,)),
    ]
    markdown = changed_markdown(changed)
    if markdown:
        steps.append(
            ("prettier", ["bun", "x", "prettier", "--check", *markdown], (_PRETTIER_WARN,))
        )
        steps.append(
            ("cspell", ["bun", "x", "cspell", "--no-progress", *markdown], (_CSPELL_ISSUE,))
        )
    return steps


def _external_step(
    worktree: Path,
    story_number: int,
    label: str,
    argv: list[str],
    patterns: tuple[re.Pattern, ...],
) -> "GateFailure | None":
    result = _launch(argv, worktree, story_number, label)
    output = "\n".join(
        stream.strip() for stream in (result.stdout, result.stderr) if stream.strip()
    )
    if result.returncode == 0:
        return None
    if result.returncode != 1:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"{label} crashed (exit {result.returncode}): {output[-800:]}",
            story_number,
            add_blocked=True,
        )
    culprits = _named_files(patterns, output)
    detail = "\n".join(f"  {line}" for line in _head(output) or ["(the gate printed nothing)"])
    return GateFailure(f"{label} failed:\n{detail}", culprits, bool(culprits))


def _named_files(patterns: tuple[re.Pattern, ...], output: str) -> frozenset[str]:
    return frozenset(
        match.group(1)
        for pattern in patterns
        for line in output.splitlines()
        if (match := pattern.match(line)) is not None
    )


def narrate_gates(steps_run: int, tool: str = "verify:changed") -> None:
    from fitflow import narrate

    if tool == "verify:changed":
        narrate.line(f"🧪 Gates: verify:changed ✔ ({steps_run} steps)")
        return
    narrate.line(f"🧪 Gates: {tool} ✔")
