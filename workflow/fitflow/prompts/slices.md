# Planner: spans domain and UI?

Same story, #$story_number "$story_title" - decide how to slice it for
implementation.

Current body:
$story_body

Issue history (oldest first; collected by the driver):
$issue_context

Use only the issue evidence above. Do not browse GitHub yourself.

Fit_ has three slice categories. Two of them are the product:

- "ui" means frontend/interface work in Svelte components and routes,
  normally tested in the browser with Playwright.
- "domain" means every non-UI change to the product. It includes framework-free
  domain logic, server/backend code, persistence, migrations, and database changes,
  normally tested with Vitest. Do not invent separate backend, server,
  persistence, migration, or database layers.

The third is the driver itself:

- "workflow" means a change to this development flow's own driver: the
  Python package under `workflow/`, its tests and fakes, and the
  documentation that describes it (`workflow/README.md`,
  `workflow/delegation-contract.md`, `docs/development-flow.md`). Choose it
  when the work changes how the flow runs rather than what Fit_ does. A
  workflow slice may touch `workflow/**`, `docs/**` and `cspell.json`, and
  nothing else - a story that needs both the driver and the product is two
  stories, not two slices.

A workflow story is always exactly one slice: spans_domain_and_ui is false,
there is no sibling, and "workflow" never appears beside "domain" or "ui".
Its acceptance tests are pytest files under `workflow/tests/`, in the
repository's own style - either a flow test (a fake world plus a `go.py`
run, asserting on the exit code, the narrated log and the fake world
afterwards) or a unit test of one `fitflow` module.

Does this story span both product categories, sit entirely in UI, entirely
in non-UI domain work, or entirely in the driver?

Reply with the schema fields: spans_domain_and_ui (true or false), and slices

- exactly one slice if spans_domain_and_ui is false, whether that one slice is
  wholly UI, wholly non-UI, or wholly the driver. Return exactly two slices if
  it is true: one "domain", then one "ui", in that order. Two is the maximum;
  never return a third slice. Never mark a workflow story as spanning.
  Each slice needs:
  layer (domain, ui or workflow), title (short), brief (what to build, for
  whoever implements it), acceptance (a list of observable, testable
  criteria), and test_kind (vitest for a domain slice, playwright for a ui
  slice, pytest for a workflow slice).
