"""Whether the failure that came back is the same failure.

A corrective turn is worth taking only when the agent can act on what it
was told. A diagnostic that comes back identical after a corrective turn
says the opposite: the agent already tried, the verdict did not move, and
the remaining attempts would only reproduce it. The loops that own a turn
budget (block 1's `turns.repair_loop`, block 3's `implement._settle`) ask
here whether attempt N+1 failed exactly as attempt N, and stop early when
it did - #406 spent three mechanic turns and ten minutes on a diagnostic
the driver's own test-file rule was wrong about, which no reply could ever
have fixed.

"Identical" is judged on the diagnostic's substance. Two runs of the same
failure differ in the parts that move on their own - the commit they were
taken at, how long a step took, the wall-clock stamp a tool printed, the
epoch milliseconds svelte-check stamps on every line, whether cspell read
a file or its cache, the absolute worktree path the run happened in - and
those are normalized away. Everything else counts: a different failing
test, a different file, a different count is a different failure, and its
correction is worth the attempt.

Every one of those movers was in a single #422 diagnostic: the same
`verify:changed` verdict came back with svelte-check's 13-digit stamps
re-stamped, vitest's `Start at` and `Duration` a quarter of a minute later,
and cspell's file count carrying `(748 from cache)` the second time. The
substance - which step, which file, which line, how many - had not moved
at all.
"""

import re

# Applied in this order: a timestamp and a worktree path are recognised
# whole, before the sha and duration patterns could bite pieces out of
# them.
_SUBSTITUTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?"), "<timestamp>"),
    (re.compile(r"(?:/[^\s:,'\"]*)?/\.claude/worktrees/[^\s:,'\")]*"), "<worktree>"),
    (re.compile(r"\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b"), "<clock>"),
    # epoch milliseconds: svelte-check stamps one on every line it prints,
    # and they are all hex-free digits, so the sha rule below never sees
    # them
    (re.compile(r"\b\d{13}\b"), "<epoch>"),
    (
        re.compile(r"\b\d+(?:[.,]\d+)?\s*(?:ms|s|m|h|secs?|seconds?|mins?|minutes?|hours?)\b"),
        "<duration>",
    ),
    # cspell says how much of its work it skipped; a warm cache is not a
    # different verdict, so the suffix goes rather than becoming a
    # placeholder - "749 (748 from cache)" has to read as "749"
    (re.compile(r"\s*\(\d+ from cache\)"), ""),
    # a git object name: hex, at least seven wide, and carrying both a
    # digit and a letter, so ordinary words and ordinary numbers stay
    # themselves
    (re.compile(r"\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b"), "<sha>"),
    (re.compile(r"\s+"), " "),
)


def normalize(diagnostic: str) -> str:
    """The diagnostic with its volatile parts replaced by placeholders:
    what two attempts of the same failure have in common."""
    text = diagnostic
    for pattern, placeholder in _SUBSTITUTIONS:
        text = pattern.sub(placeholder, text)
    return text.strip()


def same_diagnostic(earlier: str, later: str) -> bool:
    """True when the two attempts failed the same way. An empty diagnostic
    is never the same as anything - the first attempt of a role has no
    predecessor to repeat."""
    if not earlier.strip() or not later.strip():
        return False
    return normalize(earlier) == normalize(later)
