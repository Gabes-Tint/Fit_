# $role_capitalized: correct the rejected implementation

Continue in the same session, branch, and worktree for slice #$slice_number:
$slice_title, still as the $role_name.

The Python driver rejected attempt $attempt with this concrete diagnostic:

$diagnostic

Fix the smallest change needed so the driver's validation passes. Keep the
rules from the original brief: work only in this worktree, never commit or
push (the driver owns commits), never modify the acceptance test files
listed below or weaken their assertions, never touch workflow or gate
policy files, and keep every test file in the slice's test kind
($test_kind).

Original brief:
$brief

Acceptance criteria:
$acceptance

Test kind: $test_kind

Acceptance tests that must pass unmodified:
$test_files

Reply with the existing schema fields: changed_files (every path currently
changed in the worktree since the driver's commit - the full accumulated
diff, including everything that was already rejected, not only the paths
touched in this correction, relative to the repo root) and summary (what
you changed for this correction).
