"""What the type and lint lanes said, error by error.

`bun run check` and `bun run lint:changed` give a single exit code and a
wall of text. Block 1 has to ask a finer question of that text: an
acceptance test for a story that introduces a new function, method, prop or
export *must* name the API before it exists, so the type lane reports
errors inside the test file and the type-aware lint rules see `any` flowing
out of the import that does not resolve yet. Those errors are the failing
test doing its job; the implementation is what makes them go away. Any
other error, and any error outside the acceptance files, still rejects the
branch.

So the lanes' output is parsed into individual errors - the file, the rule
id or TS code, the message - and each one is asked whether it belongs to
that tolerated set. A reading that is not `complete` is one the driver did
not fully understand, and nothing may be concluded from it: the caller
stays strict, exactly as it was before this module existed.

Three type-lane shapes are read, because `svelte-check` picks one by where
its output goes and `tsc` writes a third:

    1789326030396 ERROR "src/lib/tend.svelte.spec.ts" 1485:22 "Expected 1 arguments, but got 2."

    src/routes/typed.e2e.ts:12:30
    Error: Argument of type 'number' is not assignable to parameter of type 'Locator'. (ts)

    src/lib/typed.spec.ts(12,30): error TS2554: Expected 1 arguments, but got 2.

and eslint's stylish report, whose file name sits on its own line above the
problems it owns:

    src/routes/live.e2e.ts
      180:16  error  Unsafe call of an `any` typed value.  @typescript-eslint/no-unsafe-call
"""

import re
from dataclasses import dataclass

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_SOURCE = r"[\w./@+-]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|svelte)"


@dataclass(frozen=True)
class LaneError:
    """One error a lane reported: the file it blames, the eslint rule id or
    TS code that fired (empty when the lane printed neither), and the
    message."""

    file: str
    rule: str
    message: str

    def described(self) -> str:
        head = f"{self.file} {self.rule}".strip()
        return f"{head}: {self.message}" if self.message else head


@dataclass(frozen=True)
class LaneReading:
    """Every error read out of one lane's output, and whether that reading
    accounts for all of it. `complete` is false when the lane printed a
    problem the parser could not place, or when its own summary counted
    more problems than were read: a partial reading may never be the basis
    for tolerating anything."""

    errors: tuple[LaneError, ...] = ()
    complete: bool = False


# --- what an acceptance test is allowed to break before the API exists ------

#: The eslint rules a failing acceptance test may break on its own branch.
#:
#: Every one of these fires for the same reason: a value the test imported
#: resolved to `any`, because the export it names does not exist yet, and
#: the type-aware rules then see `any` flowing into a call, a property read,
#: an assignment, an argument or a return. #424's acceptance file produced
#: 186 of them against `page.getByRole` alone. The implementation that adds
#: the export silences all five at once, and nothing the mechanic may
#: legally write silences them earlier - `@ts-expect-error`, a cast to
#: `any` and a stub are each rejected elsewhere in block 1, and the test
#: bytes are immutable by the time the implementation lands.
#:
#: Nothing else joins this set. A formatting rule, an unused import,
#: `no-console`, a parsing error: none of those become true when the
#: implementation appears, so they are the mechanic's to fix now.
TOLERATED_LINT_RULES = frozenset(
    {
        "@typescript-eslint/no-unsafe-call",
        "@typescript-eslint/no-unsafe-member-access",
        "@typescript-eslint/no-unsafe-assignment",
        "@typescript-eslint/no-unsafe-argument",
        "@typescript-eslint/no-unsafe-return",
    }
)

#: The TypeScript diagnostics an acceptance test may carry before the API
#: it calls exists. Each is a way of saying "what the brief describes is
#: not there yet", and each is answered by the implementation providing it
#: - never by changing the test.
TOLERATED_TS_CODES = frozenset(
    {
        "TS2339",  # Property 'x' does not exist on type 'Y' - the method the story adds
        "TS2551",  # the same, with tsc's "Did you mean 'y'?" suggestion
        "TS2554",  # Expected N arguments, but got M - the signature the story widens (#423)
        "TS2555",  # Expected at least N arguments, but got M - the same, with optionals
        "TS2345",  # Argument of type A is not assignable to parameter B - the new parameter
        "TS2305",  # Module '...' has no exported member 'x' - the export the story adds
        "TS2724",  # the same, with tsc's "Did you mean 'y'?" suggestion
        "TS2307",  # Cannot find module - only for a path inside this repository
    }
)

#: The same diagnostics by their wording, for the lanes that print no code.
#: `svelte-check` reports the message alone in both of its output shapes,
#: so without these the tolerated set would be unreachable in the
#: repository's own type lane.
_TOLERATED_TS_MESSAGES = (
    re.compile(r"^Property '[^']*' does not exist on type\b"),
    re.compile(r"^Expected \d+(?:-\d+)? arguments?, but got \d+"),
    re.compile(r"^Expected at least \d+ arguments?, but got \d+"),
    re.compile(r"^Argument of type .* is not assignable to parameter of type\b"),
    re.compile(r"^Module '[^']*' has no exported member\b"),
    re.compile(r"^'[^']*' has no exported member named\b"),
)

#: A module specifier that names this repository rather than a package:
#: relative, or through SvelteKit's `$lib` alias, or spelled from the root.
#: `TS2307` on one of those is the module the story adds; `TS2307` on
#: `vitest` or `@playwright/test` is a broken checkout, and stays a
#: rejection.
_LOCAL_MODULE = re.compile(r"^(?:\.{1,2}/|\$lib(?:/|$)|src/)")
_MISSING_MODULE = re.compile(r"^Cannot find module '([^']*)'")


def tolerated_lint_error(error: LaneError) -> bool:
    """Whether this eslint error is the story's missing API talking."""
    return error.rule in TOLERATED_LINT_RULES


def tolerated_type_error(error: LaneError) -> bool:
    """Whether this type error is the story's missing API talking. A coded
    diagnostic is judged by its code, one without a code by its wording, and a
    module that cannot be found by where that module would live."""
    missing = _MISSING_MODULE.match(error.message)
    if missing is not None:
        return _LOCAL_MODULE.match(missing.group(1)) is not None
    if error.rule.startswith("TS"):
        return error.rule in TOLERATED_TS_CODES
    return any(pattern.match(error.message) for pattern in _TOLERATED_TS_MESSAGES)


# --- eslint -----------------------------------------------------------------

_ESLINT_FILE = re.compile(rf"^({_SOURCE}|[\w./@+-]+\.(?:json|md|css|html))\s*$")
_ESLINT_PROBLEM = re.compile(r"^\s+\d+:\d+\s+(?:error|warning)\s+(.*?)\s\s+([@\w][\w@/.-]*)\s*$")
_ESLINT_ANY_PROBLEM = re.compile(r"^\s+\d+:\d+\s+(?:error|warning)\s+\S")
_ESLINT_TOTAL = re.compile(r"^[^\w]*(\d+) problems?\b", re.MULTILINE)


def lint_errors(output: str) -> LaneReading:
    """eslint's stylish report, read as individual problems."""
    errors: list[LaneError] = []
    understood = True
    current = ""
    for line in _plain_lines(output):
        header = _ESLINT_FILE.match(line)
        if header is not None:
            current = header.group(1)
            continue
        problem = _ESLINT_PROBLEM.match(line)
        if problem is None:
            understood = understood and _ESLINT_ANY_PROBLEM.match(line) is None
            continue
        if not current:
            understood = False
            continue
        errors.append(LaneError(current, problem.group(2), problem.group(1)))
    return LaneReading(tuple(errors), _complete(errors, understood, _ESLINT_TOTAL, output))


# --- svelte-check and tsc ---------------------------------------------------

_SVELTE_MACHINE = re.compile(rf'^\d+\s+(?:ERROR|WARNING)\s+"({_SOURCE})"\s+\d+:\d+\s+"(.*)"\s*$')
_TSC = re.compile(
    rf"^({_SOURCE})(?:\(\d+,\d+\)|:\d+:\d+)\s*[-:]?\s*(?:error|warning)\s+(TS\d+):\s*(.*)$"
)
_SVELTE_HUMAN_FILE = re.compile(rf"^({_SOURCE}):\d+:\d+\s*$")
_SVELTE_HUMAN_MESSAGE = re.compile(r"^(?:Error|Warn(?:ing)?):\s*(.*?)\s*(?:\(ts\))?$")
_SVELTE_TOTAL = re.compile(
    r"(?:COMPLETED\s+\d+\s+FILES\s+(\d+)\s+ERRORS\s+(\d+)\s+WARNINGS"
    r"|found\s+(\d+)\s+errors?\s+and\s+(\d+)\s+warnings?)"
)


def type_errors(output: str) -> LaneReading:
    """`bun run check`'s output, read as individual diagnostics, in
    whichever of svelte-check's two shapes or tsc's own it arrived."""
    lines = _plain_lines(output)
    errors = [error for error in (_typed_line(line) for line in lines) if error is not None]
    errors.extend(_human_type_errors(lines))
    return LaneReading(tuple(errors), _complete(errors, True, _SVELTE_TOTAL, output))


def _typed_line(line: str) -> LaneError | None:
    machine = _SVELTE_MACHINE.match(line)
    if machine is not None:
        return LaneError(machine.group(1), "", machine.group(2))
    coded = _TSC.match(line)
    if coded is not None:
        return LaneError(coded.group(1), coded.group(2), coded.group(3))
    return None


def _human_type_errors(lines: list[str]) -> list[LaneError]:
    """svelte-check's human report puts the location on one line and the
    message on the next, so the two are only meaningful as a pair."""
    errors = []
    for index, line in enumerate(lines[:-1]):
        where = _SVELTE_HUMAN_FILE.match(line)
        if where is None:
            continue
        message = _SVELTE_HUMAN_MESSAGE.match(lines[index + 1])
        if message is not None:
            errors.append(LaneError(where.group(1), "", message.group(1)))
    return errors


# --- shared -----------------------------------------------------------------


def _plain_lines(output: str) -> list[str]:
    return [_ANSI.sub("", raw).rstrip() for raw in (output or "").splitlines()]


def _complete(errors: list[LaneError], understood: bool, total: re.Pattern, output: str) -> bool:
    """A reading is complete when something was read, nothing was skipped,
    and the lane's own summary - when it printed one - counts no more
    problems than were read."""
    if not errors or not understood:
        return False
    counted = _counted(total, output)
    return counted is None or counted == len(errors)


def _counted(total: re.Pattern, output: str) -> int | None:
    """How many problems the lane said it found, or None when it did not
    say. Errors and warnings both count: the type lane runs with
    `--fail-on-warnings`."""
    match = total.search(_ANSI.sub("", output or ""))
    if match is None:
        return None
    return sum(int(group) for group in match.groups() if group is not None)
