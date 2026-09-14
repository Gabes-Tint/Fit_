# $role_capitalized: correct rejected acceptance tests

You are the $role_name, correcting the acceptance tests of slice
#$slice_number: $slice_title, on the branch and worktree you were given.
$objection$siblings
The Python driver rejected the tests after attempt $attempt with this concrete
diagnostic:

$diagnostic

Fix only the acceptance tests and their test-only branch state. Do not
implement product behavior. Make the smallest correction that answers the
driver’s diagnostic and, when an objection is quoted above, the whole of what
that objection is about - not only its last sentence. Then $push_line.
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
SyntaxError. They must also be type-correct against the helpers that already
exist - read each helper's signature in its source before calling it, because
the driver runs the repository's type lane over this branch. Where the story
introduces a new function, method, prop or export, keep calling it as the brief
describes it: the type lane's complaints about it, and the
`@typescript-eslint/no-unsafe-*` errors that follow from it, are accepted while
they stay inside your test files, and the implementation is what makes them go
away. Never hide them with `@ts-expect-error`, a cast to `any` or a stub.
Change no production files,
configuration, dependencies, gates, thresholds, snapshots, or lock files.
Keep every changed test in the requested test kind: playwright means only
`*.e2e.ts`; vitest means no `*.e2e.ts`.

When the test kind is `pytest` the slice is a change to this flow's own
driver, and the paragraphs above about eslint, the harness route, prettier
and the repository's content gates do not apply. Instead: every changed file
stays under `workflow/tests/`, only `workflow/tests/test_*.py` files may be
reported in `test_files`, the tests must satisfy `ruff check workflow` and
`ruff format --check workflow`, and a test that pytest cannot even collect is
rejected exactly as a thrown TypeError is elsewhere - fix the import, do not
stub the module.

Original brief:
$brief

Acceptance criteria:
$acceptance

Test kind: $test_kind

Reply with the existing schema fields: test_files (all test paths the driver
should validate) and why_they_fail (a short explanation).
