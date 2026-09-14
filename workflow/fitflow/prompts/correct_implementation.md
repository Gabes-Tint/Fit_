# $role_capitalized: correct the rejected implementation

Continue in the same session, branch, and worktree for slice #$slice_number:
$slice_title, still as the $role_name.

The Python driver rejected attempt $attempt with this concrete diagnostic:

$diagnostic

Fix the smallest change needed so the driver's validation passes. Keep the
rules from the original brief: work only in this worktree, never commit or
push (the driver owns commits), and never modify the acceptance test files
listed below or weaken their assertions - their bytes must stay identical.
Any other test inside this slice's own layer may change. These paths remain
out of reach, and a diff that touches any of them is rejected again:

$forbidden

Everything else in the repository is in reach, including the driver's own
code under `workflow/` and the application tooling under `scripts/` that is
not listed above - except in a slice whose test kind is `pytest`, which is a
change to the driver itself and may touch only `workflow/**`, `docs/**` and
`cspell.json`.

Original brief:
$brief
$scope_note

Acceptance criteria:
$acceptance

Test kind: $test_kind

Acceptance tests that must pass unmodified:
$test_files

When the diagnostic cannot be repaired because the tests themselves are
wrong:

$objecting

Reply with the existing schema fields: changed_files (every path the
working tree diff touches relative to this branch's starting commit - added,
modified, deleted and renamed files, both names of a rename, the full
accumulated diff including everything that was already rejected rather than
only the paths touched in this correction, relative to the repo root) and
summary (what you changed for this correction). The driver compares that
list against `git status`, so a path you deleted counts exactly like one you
wrote. Always send objection: set it to `null` unless the case above
applies; when it does, make it an object with kind, tests, why and
proposed_fix (`null` when you propose no repair), and then changed_files may
be empty.
