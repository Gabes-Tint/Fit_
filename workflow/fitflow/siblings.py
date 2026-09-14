"""What the repository already does, for the agent repairing a rejected
acceptance test.

Every objection the driver verified on #421 was right about the product and
right about the repair, and the mechanic still could not make it: the tests
needed the fixture, the clock control and the seeded state the other
`*.e2e.ts` in `src/routes/` already use, and nothing in the repair brief
said those files existed. The repairer is a fresh session in a fresh
worktree - it has no memory of block 1's own turn - so the brief carries a
short inventory of the sibling tests of the same kind, nearest paths first,
with one line each: enough to go and read the right two files rather than
invent a fourth way of seeding a week planner.

The inventory is taken from `git ls-files` in the repair worktree, so it
describes the tree the repair is actually made on.
"""

import re
import subprocess
from pathlib import Path

from fitflow import acceptance

#: Short enough to read before starting; long enough to hold the layer's
#: real conventions. Nearest paths win when there are more.
MAX_ENTRIES = 15

#: Test-side support a playwright repair almost always needs, listed first
#: because it is where the fixtures themselves live.
SUPPORT = {"playwright": ("tests/e2e-support.ts", "tests/preview-server.ts")}

_SUMMARY_LIMIT = 90
_DOCSTRING_LINES = 3
_NAMES = 4
_TITLE = re.compile(r"^\s*(?:test|it|describe)(?:\.\w+)?\s*\(\s*['\"`]([^'\"`]+)")
_DOCSTRING = re.compile(r'^\s*"""\s*(\S.*)')
_EXPORT = re.compile(r"^\s*export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)")
_DEF = re.compile(r"^\s*def\s+(\w+)")


def section(worktree: Path, test_kind: str, test_files: list[str]) -> str:
    """The block the repair prompt carries, or "" when this tree holds no
    sibling of this kind - in which case the prompt reads exactly as it did
    before an inventory existed."""
    entries = inventory(worktree, test_kind, test_files)
    if not entries:
        return ""
    listed = "\n".join(f"- `{path}` — {summary}" for path, summary in entries)
    return (
        "\nThese are the repository's own tests of this kind, nearest first. Read the "
        "closest two before you change anything and imitate what they do - their "
        "fixtures, how they control the clock, and how they seed the state a test "
        "needs - rather than inventing another way:\n\n"
        f"{listed}\n"
    )


def inventory(worktree: Path, test_kind: str, test_files: list[str]) -> list[tuple[str, str]]:
    """(path, one line) for each sibling, support files first and then the
    nearest test paths, capped at `MAX_ENTRIES`."""
    tracked = _tracked(worktree)
    chosen = [path for path in SUPPORT.get(test_kind, ()) if path in tracked]
    siblings = [
        path
        for path in tracked
        if path not in test_files and path not in chosen and _is_sibling(test_kind, path)
    ]
    chosen.extend(sorted(siblings, key=lambda path: _distance(path, test_files)))
    return [(path, _summary(worktree / path)) for path in chosen[:MAX_ENTRIES]]


def _tracked(worktree: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"], cwd=worktree, capture_output=True, text=True, check=False
    )
    return [line for line in result.stdout.splitlines() if line]


def _is_sibling(test_kind: str, path: str) -> bool:
    """A test of the same kind this slice writes - the same rule block 1 is
    held to, so the inventory can never suggest a file the repair may not
    imitate."""
    if test_kind == "pytest":
        return acceptance.names_an_acceptance_test("pytest", path)
    return acceptance.TEST_FILE.search(path) is not None and acceptance.matches_test_kind(
        test_kind, path
    )


def _distance(path: str, test_files: list[str]) -> tuple[int, str]:
    """How far a sibling is from the tests being repaired: the longest run
    of leading path segments it shares with any of them, negated so the
    nearest sorts first, with the path itself breaking ties."""
    nearest = max((_shared(path, test) for test in test_files), default=0)
    return (-nearest, path)


def _shared(left: str, right: str) -> int:
    count = 0
    for first, second in zip(left.split("/")[:-1], right.split("/")[:-1], strict=False):
        if first != second:
            break
        count += 1
    return count


def _summary(path: Path) -> str:
    """One line about a file: the first test title it declares, else what it
    exports, else its first line of content."""
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return "(unreadable)"
    return _documented(lines) or _titled(lines) or _defined(lines) or _first_line(lines)


def _documented(lines: list[str]) -> str:
    """A Python module says what it is in its own docstring, and the
    driver's own tests all have one."""
    for index, line in enumerate(lines[:_DOCSTRING_LINES]):
        if line.strip() == '"""':
            return _clipped(_first_line(lines[index + 1 :]))
        match = _DOCSTRING.match(line)
        if match:
            return _clipped(match.group(1).removesuffix('"""').strip())
    return ""


def _titled(lines: list[str]) -> str:
    for line in lines:
        match = _TITLE.match(line)
        if match:
            return f'first test: "{_clipped(match.group(1))}"'
    return ""


def _defined(lines: list[str]) -> str:
    names = []
    for line in lines:
        match = _EXPORT.match(line) or _DEF.match(line)
        if match and match.group(1) not in names:
            names.append(match.group(1))
    return f"defines {', '.join(names[:_NAMES])}" if names else ""


def _first_line(lines: list[str]) -> str:
    for line in lines:
        if line.strip():
            return _clipped(line.strip())
    return "(empty)"


def _clipped(text: str) -> str:
    return text if len(text) <= _SUMMARY_LIMIT else f"{text[: _SUMMARY_LIMIT - 1]}…"
