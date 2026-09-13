# Mechanic: correct rejected acceptance tests

Continue in the same session, branch, and worktree for slice #$slice_number:
$slice_title.

The Python driver rejected attempt $attempt with this concrete diagnostic:

$diagnostic

Fix only the acceptance tests and their test-only branch state. Do not
implement product behavior. Make the smallest correction needed for the
driver’s diagnostic, then commit and push the corrected tests to `$branch`.
Import and exercise the product boundary; never define a local stand-in for
the missing product function or class inside the test.
If a new domain module does not exist yet, dynamically import it inside the
assertion and call the expected export in the promise chain, so a real
assertion fails without adding a stub.

No lint suppression is acceptable in a failing acceptance test - no
`eslint-disable`, `eslint-enable`, `@ts-ignore` or `@ts-expect-error`; and a
playwright component assertion goes through `/dev/component-harness`, never
through `page.evaluate` imports or a route fixture of your own. The tests
are immutable inputs to implementation, so they must lint clean both before
and after the behavior exists.

The test files must also pass the repository's own content gates, which the
implementation gate will run over these same bytes when nobody can change
them any more: `duplicates` (copy-paste detection, ratchet 0 - extract a
repeated setup or assertion block into a helper rather than pasting it into
a second test), `format:check` (run `bunx prettier --write` over the files
you wrote) and `check:suppressions`. When the diagnostic above names a
clone, it gives both halves as `file:startLine-endLine`: read those exact
line ranges before you change anything.

The tests must fail because the requested behavior is missing, not because of
syntax, imports, or test-runner errors: each one fails on an expectation the
implementation would satisfy, never on a thrown TypeError, ReferenceError or
SyntaxError. They must also be type-correct against the helpers they import -
read each helper's signature in its source before calling it, because the
driver runs the repository's type lane over this branch. Change no production files,
configuration, dependencies, gates, thresholds, snapshots, or lock files.
Keep every changed test in the requested test kind: playwright means only
`*.e2e.ts`; vitest means no `*.e2e.ts`.

Original brief:
$brief

Acceptance criteria:
$acceptance

Test kind: $test_kind

Reply with the existing schema fields: test_files (all test paths the driver
should validate) and why_they_fail (a short explanation).
