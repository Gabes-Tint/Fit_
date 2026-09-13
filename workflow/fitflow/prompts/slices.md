# Planner: spans domain and UI?

Same story, #$story_number "$story_title" - decide how to slice it for
implementation.

Current body:
$story_body

Issue history (oldest first; collected by the driver):
$issue_context

Use only the issue evidence above. Do not browse GitHub yourself.

Fit_ has exactly two slice categories:

- "ui" means frontend/interface work in Svelte components and routes,
  normally tested in the browser with Playwright.
- "domain" means every non-UI change. It includes framework-free domain
  logic, server/backend code, persistence, migrations, and database changes,
  normally tested with Vitest. Do not invent separate backend, server,
  persistence, migration, or database layers.

Does this story span both categories, or sit entirely in UI or entirely in
non-UI domain work?

Reply with the schema fields: spans_domain_and_ui (true or false), and slices

- exactly one slice if spans_domain_and_ui is false, whether that one slice is
  wholly UI or wholly non-UI. Return exactly two slices if it is true: one
  "domain", then one "ui", in that order. Two is the maximum; never return a
  third slice. Each slice needs:
  layer (domain or ui), title (short), brief (what to build, for whoever
  implements it), acceptance (a list of observable, testable criteria), and
  test_kind (vitest for a domain slice, playwright for a ui slice).
