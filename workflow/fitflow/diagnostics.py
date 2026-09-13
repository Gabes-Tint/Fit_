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
absolute worktree path the run happened in - and those are normalised
away. Everything else counts: a different failing test, a different file,
a different count is a different failure, and its correction is worth the
attempt.
"""

import re

# Applied in this order: a timestamp and a worktree path are recognised
# whole, before the sha and duration patterns could bite pieces out of
# them.
_SUBSTITUTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?"), "<timestamp>"),
    (re.compile(r"(?:/[^\s:,'\"]*)?/\.claude/worktrees/[^\s:,'\")]*"), "<worktree>"),
    (re.compile(r"\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b"), "<clock>"),
    (
        re.compile(r"\b\d+(?:[.,]\d+)?\s?(?:ms|s|m|h|secs?|seconds?|mins?|minutes?|hours?)\b"),
        "<duration>",
    ),
    # a git object name: hex, at least seven wide, and carrying both a
    # digit and a letter, so ordinary words and ordinary numbers stay
    # themselves
    (re.compile(r"\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b"), "<sha>"),
    (re.compile(r"\s+"), " "),
)


def normalise(diagnostic: str) -> str:
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
    return normalise(earlier) == normalise(later)
