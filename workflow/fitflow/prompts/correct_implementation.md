# $role_capitalized: correct the rejected implementation

Continue in the same session, branch, and worktree for slice #$slice_number:
$slice_title, still as the $role_name.

The Python driver rejected attempt $attempt with this concrete diagnostic:

$diagnostic

Fix the smallest change needed so the driver's validation passes. Keep the
rules from the original brief: work only in this worktree, never commit or
push (the driver owns commits), never touch workflow or gate policy files,
and never modify the acceptance test files listed below or weaken their
assertions - their bytes must stay identical. Any other test inside this
slice's own layer may change. When the test kind is `pytest` the slice is a
change to the driver itself, so `workflow/**`, `docs/**` and `cspell.json`
are exactly what it may touch, and nothing outside them is.

Original brief:
$brief

Acceptance criteria:
$acceptance

Test kind: $test_kind

Acceptance tests that must pass unmodified:
$test_files

Reply with the existing schema fields: changed_files (every path the
working tree diff touches relative to this branch's starting commit - added,
modified, deleted and renamed files, both names of a rename, the full
accumulated diff including everything that was already rejected rather than
only the paths touched in this correction, relative to the repo root) and
summary (what you changed for this correction). The driver compares that
list against `git status`, so a path you deleted counts exactly like one you
wrote.
