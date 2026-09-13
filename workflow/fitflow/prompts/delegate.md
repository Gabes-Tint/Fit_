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
  investigation beyond applying a known pattern. It contradicts
  technical_choice="bounded": a bounded choice is ordinary construction
  within a known pattern, so when you report that the choice is limited,
  solution_uncertain is false.
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

## Reply fields

`slices`: one entry per slice, each with

- layer: "domain" or "ui"
- signals: exactly the nine signals above
- evidence: at least one entry per signal, each {signal, source_ref,
  detail}; signal names one of the nine signals; source_ref must be one of
  this run's retained inputs, written exactly as:

  - run-$story_number/<layer>/brief
  - run-$story_number/<layer>/acceptance/<n> (0-based index into that
    slice's acceptance criteria)
  - run-$story_number/<layer>/issue_context
  - run-$story_number/<layer>/failing_tests
  - run-$story_number/<layer>/branch
  - run-$story_number/<layer>/worktree
  - run-$story_number/<layer>/team
  - run-$story_number/ownership

  where <layer> is the slice's own layer. detail explains why the signal
  has that value.

- unresolved: array of signal names you could not resolve (may be empty)
- needs_sibling (boolean): true when this slice's acceptance tests cannot
  be implemented and validated independently of the sibling slice's
  implementation (a one-slice story is always false)

The driver, not you, chooses the rung from these signals and owns all
transitions afterward.

## The slices

$slices
