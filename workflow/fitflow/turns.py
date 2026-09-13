"""The one turn budget shared by every bounded correction loop: one
initial attempt plus two repair attempts. `repair_loop` is for loops that
do not themselves mutate a persisted run record - block 3's level loop
escalates and rewrites `SliceRecord` state, so it keeps its own loop and
only reads `BUDGET` and the repetition rule from here.

The budget is a ceiling, not a quota: a diagnostic that comes back
identical after a corrective turn ends the loop where it stands. See
fitflow.diagnostics for what "identical" means and why.
"""

from collections.abc import Callable

from fitflow import narrate
from fitflow.diagnostics import same_diagnostic
from fitflow.outcome import FlowFailure

BUDGET = 3


def unspent_attempts(attempt: int) -> str:
    """Why a loop stopped before its budget, for the line a human reads on
    the issue: the attempts that were deliberately not spent, and what
    spending them would have bought."""
    return (
        f"stopped early: attempt {attempt} failed exactly as attempt {attempt - 1}, so a "
        f"further correction would only reproduce it; {BUDGET - attempt} of {BUDGET} "
        f"attempts went unspent"
    )


def repair_loop[T](
    label: str,
    run: Callable[[int, str], T],
    repairable: Callable[[FlowFailure], bool],
) -> T:
    """Call `run(attempt, diagnostic)` for attempt 1..BUDGET, `diagnostic`
    starting empty. A FlowFailure `repairable` rejects propagates at once,
    unnarrated - the caller's own contract/tool-failure handling applies to
    it. A repairable failure becomes the next attempt's diagnostic and is
    narrated as a retry, as an early stop when it repeats the previous
    attempt's diagnostic, or as exhaustion on the last attempt, then
    re-raised. Attempt 1 succeeding is silent; a later attempt succeeding
    is narrated."""
    diagnostic = ""
    for attempt in range(1, BUDGET + 1):
        try:
            result = run(attempt, diagnostic)
        except FlowFailure as failure:
            if not repairable(failure):
                raise
            previous, diagnostic = diagnostic, f"{failure.outcome.name}: {failure.why}"
            _stop_or_retry(label, failure, attempt, previous, diagnostic)
            continue
        if attempt > 1:
            narrate.line(f"✅ {label} passed validation on attempt {attempt}")
        return result
    raise AssertionError("unreachable: the loop always returns or raises")


def _stop_or_retry(
    label: str, failure: FlowFailure, attempt: int, previous: str, diagnostic: str
) -> None:
    """Narrate this attempt's rejection, and return only when another
    attempt is worth taking. An identical failure after a corrective turn
    means the diagnostic, not the agent, is the problem: the loop stops
    with the failure exhaustion would have raised, saying so."""
    if attempt == BUDGET:
        narrate.headed(f"🛑 {label} exhausted {BUDGET} attempts — ", diagnostic)
        raise failure
    if same_diagnostic(previous, diagnostic):
        narrate.headed(
            f"🛑 {label} stopped early: attempt {attempt} failed exactly as "
            f"attempt {attempt - 1} — ",
            diagnostic,
        )
        raise _repeated(failure, attempt) from failure
    narrate.headed(f"🔁 {label} retrying after attempt {attempt} — ", diagnostic)


def _repeated(failure: FlowFailure, attempt: int) -> FlowFailure:
    """The same failure, with the unspent attempts noted so the comment on
    the story says why the budget was not burned."""
    return FlowFailure(
        failure.outcome,
        f"{failure.why} ({unspent_attempts(attempt)})",
        failure.story_number,
        failure.add_blocked,
    )
