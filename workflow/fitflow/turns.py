"""The one turn budget shared by every bounded correction loop: one
initial attempt plus two repair attempts. `repair_loop` is for loops that
do not themselves mutate a persisted run record - block 3's level loop
escalates and rewrites `SliceRecord` state, so it keeps its own loop and
only reads `BUDGET` from here.
"""

from collections.abc import Callable

from fitflow import narrate
from fitflow.outcome import FlowFailure

BUDGET = 3


def repair_loop[T](
    label: str,
    run: Callable[[int, str], T],
    repairable: Callable[[FlowFailure], bool],
) -> T:
    """Call `run(attempt, diagnostic)` for attempt 1..BUDGET, `diagnostic`
    starting empty. A FlowFailure `repairable` rejects propagates at once,
    unnarrated - the caller's own contract/tool-failure handling applies to
    it. A repairable failure becomes the next attempt's diagnostic and is
    narrated as a retry, or as exhaustion on the last attempt, then
    re-raised. Attempt 1 succeeding is silent; a later attempt succeeding
    is narrated."""
    diagnostic = ""
    for attempt in range(1, BUDGET + 1):
        try:
            result = run(attempt, diagnostic)
        except FlowFailure as failure:
            if not repairable(failure):
                raise
            diagnostic = f"{failure.outcome.name}: {failure.why}"
            if attempt == BUDGET:
                narrate.line(f"🛑 {label} exhausted {BUDGET} attempts — {diagnostic}")
                raise
            narrate.line(f"🔁 {label} retrying after attempt {attempt} — {diagnostic}")
            continue
        if attempt > 1:
            narrate.line(f"✅ {label} passed validation on attempt {attempt}")
        return result
    raise AssertionError("unreachable: the loop always returns or raises")
