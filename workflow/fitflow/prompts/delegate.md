# Planner: capability rung per slice

Same story, #$story_number "$story_title". Block 1 already wrote the failing
acceptance tests on every slice. Now decide, from the evidence only, which
capability rung each slice needs for implementation.

Use only the evidence given here. Do not browse GitHub yourself.

## The nine signals

- objective_clear (boolean): observable acceptance criteria and scope
  determine the intended behavior.
- area_known (boolean): concrete repository files or directories bound the
  implementation.
- pattern_known (boolean): a cited existing implementation provides an
  applicable pattern.
- procedure_complete (boolean): ordered instructions determine the edits
  without a relevant implementation choice.
- solution_uncertain (boolean): choosing the solution requires
  investigation beyond applying a known pattern.
- cause_uncertain (boolean): a defect's cause remains unresolved.
- technical_choice: "none", "bounded" (ordinary construction within a known
  pattern), or "open" (unresolved architectural/behavioral choice).
- sensitive_areas: unique array of "auth", "shared_state", "store",
  "security", "persistence" - only areas the change actually affects. An
  empty array means all were checked and excluded.
- human_decision (boolean): product, spend, infrastructure, secrets, gate
  lowering or data deletion still requires a decision.

Every boolean needs explicit evidence for its value; omission is not
"false". If you cannot resolve a signal from the evidence, never guess:
name it in `unresolved` instead. The driver rejects unresolved slices and
stops the run; it never silently picks a rung.

## Contradiction rules the driver enforces

- procedure_complete=true requires technical_choice="none": a complete
  procedure leaves no relevant implementation choice.
- solution_uncertain=true is incompatible with technical_choice="bounded":
  a bounded choice is ordinary construction within a known pattern, so
  choosing the solution requires no investigation beyond applying it.

## Reply fields

`slices`: one entry per slice, each with

- layer: "domain" or "ui"
- signals: exactly the nine signals above
- evidence: at least one entry per signal, each {signal, source_ref,
  detail}; signal names one of the nine signals; source_ref names exactly
  one ref per entry, never a comma-joined list, and must be one of this
  run's retained inputs, written exactly as one of these shapes (<layer> is
  the slice's own layer, "domain" or "ui"; example uses story #$story_number):

  - run-$story_number/<layer>/brief - e.g. run-$story_number/domain/brief
  - run-$story_number/<layer>/acceptance/<n> - 0-based index into that
    slice's own acceptance criteria, e.g. run-$story_number/ui/acceptance/0
    (one index per entry; never run-$story_number/ui/acceptance/0,1,2)
  - run-$story_number/<layer>/issue_context - e.g.
    run-$story_number/domain/issue_context
  - run-$story_number/<layer>/failing_tests - e.g.
    run-$story_number/ui/failing_tests
  - run-$story_number/<layer>/branch - e.g. run-$story_number/domain/branch
  - run-$story_number/<layer>/worktree - e.g. run-$story_number/ui/worktree
  - run-$story_number/<layer>/team - e.g. run-$story_number/domain/team
  - run-$story_number/ownership

  detail explains why the signal has that value.

- unresolved: array of signal names you could not resolve (may be empty)
- needs_sibling (boolean): true when this slice's acceptance tests cannot
  be implemented and validated independently of the sibling slice's
  implementation (a one-slice story is always false)

The driver, not you, chooses the rung from these signals and owns all
transitions afterward.

## The slices

$slices
