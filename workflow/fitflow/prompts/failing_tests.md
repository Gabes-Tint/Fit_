# Mechanic: failing acceptance tests

You are the mechanic. Write failing acceptance tests for one slice of Fit_'s
work - nothing else. Do not implement the behavior; the tests must fail
because the behavior is missing, never because of a syntax error or a
broken import.

Slice #$slice_number: $slice_title
Branch: $branch
Test kind: $test_kind

Brief:
$brief

Acceptance criteria:
$acceptance

Fit_ test conventions:

- A vitest spec lives next to the module it covers, under `src/`: `foo.ts` ->
  `foo.spec.ts` (or `foo.svelte.spec.ts` for a component). Domain logic under
  `src/lib`.
- A playwright end-to-end spec is named `*.e2e.ts` and lives under
  `src/routes/` - every `*.e2e.ts` in this repository does. Anywhere else
  under `src/` the coverage lane counts it as an uncovered source file
  (`test:coverage:client` includes `src/lib/**/*.{ts,svelte}` and excludes
  only `*.spec.ts`/`*.test.ts`), and CI fails on the pull request where the
  file can no longer be changed. A screen or layout change asserts
  `expectFitsViewport` from `tests/e2e-support.ts` at a 360px-wide viewport.
- A component your e2e spec must exercise but which no page renders yet is
  exercised through the repository's harness route, never through a new
  route of your own: load
  `/dev/component-harness?component=<path>&props=<json>` (see
  `src/routes/dev/component-harness/+page.svelte`; `<path>` is the component
  under `src/lib/components` or `src/lib/ui`, e.g.
  `components/StatusBadge`, and the missing component renders the
  distinctive `harness: component not found` line your failing assertions
  use). Do not write route fixtures or production files; the only files on
  this branch are the test files listed below.
- Test files only under `src/**`; nothing else on this branch.
- Write only the requested test kind: a playwright slice changes only `*.e2e.ts`;
  a vitest slice changes no `*.e2e.ts` files.

Rules:

- Write test files only. No implementation code.
- Import and exercise the product boundary. Never define a local stand-in for
  the missing product function or class inside the test.
- Every test must be type-correct against the helpers it imports. Read the
  helper's signature in its source before you call it; the driver runs the
  repository's type lane over this branch and a type error in a test file is
  rejected.
- Every test must fail on an expectation - an `expect` that the missing
  behavior would satisfy - never on a thrown error. A test that throws a
  TypeError, ReferenceError or SyntaxError is rejected: it can never pass,
  whatever the implementation does. Assert what you expect of a value rather
  than calling something that does not exist yet; a dynamic import of a module
  that does not exist is the one sanctioned exception.
- No lint suppression is acceptable in a failing acceptance test - no
  `eslint-disable`, `eslint-enable`, `@ts-ignore` or `@ts-expect-error`. The
  tests are immutable inputs to implementation, so they must lint clean both
  before and after the behavior exists: if `lint:changed` flags the tests,
  restructure the assertion instead of suppressing the rule.
- The test files must also pass the repository's own content gates, because
  the implementation gate will run them over these same bytes when nobody
  can change them any more: `duplicates` (copy-paste detection, ratchet 0 -
  extract a repeated setup or assertion block into a helper instead of
  pasting it into a second test), `format:check` (run
  `bunx prettier --write` over the files you wrote) and `check:suppressions`
  (the suppression ratchet the rule above already forbids).
- If a new domain module does not exist yet, dynamically import it inside the
  assertion and call the expected export in the promise chain. This makes the
  assertion fail both while the module is absent and while its behavior is
  wrong, without adding a stub.
- When you are done, commit with message
  `test: failing acceptance tests for #$slice_number` and run
  `git push -u origin $branch`.
- Never run a command with run_in_background; do not run the full test suite,
  only the files you wrote.

Reply with the schema fields: test_files (the paths you wrote or changed,
relative to the repo root) and why_they_fail (a short explanation).
