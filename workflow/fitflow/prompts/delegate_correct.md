# Planner: correct the rejected delegation reply

Continue in the same session for story #$story_number "$story_title"; the
same slices, same retained inputs, same schema. Your previous reply was
rejected by the driver's strict contract validation because:

$diagnostic

Revalidate the entire response yourself against the rules below and
re-submit it with the same schema. Fix the named mistake and keep everything
that already validated. Do not invent new signals or change the slice list.

Original instructions for those rules:

The reply fields, the nine signals, the evidence requirement and the exact
source_ref grammar are in the original turn: `slices` (one entry per layer:
layer, signals, evidence, unresolved, needs_sibling); evidence with
source_ref exactly one of run-$story_number/<layer>/brief,
.../acceptance/<n> (0-based, only indices that exist), .../issue_context,
.../failing_tests, .../branch, .../worktree, .../team, or
run-$story_number/ownership; detail explains the value; every one of the
nine signals needs at least one evidence entry.

Original slices:

$slices
