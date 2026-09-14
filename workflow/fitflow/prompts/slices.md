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

## Each brief stays inside its own slice's layer

A brief is an instruction to one slice, and that slice may only change files
inside its own layer: a `domain` slice may never change `src/routes/`,
`src/lib/components/` or `src/lib/ui/`; a `ui` slice may never change
`src/lib/domain/`, `src/lib/server/` or `src/lib/state/`; a `workflow` slice
may change nothing under `src/`, `scripts/`, `quality/` or `.github/`. The
driver rejects a brief that names one of those areas or tells a domain slice
to update its callers or call sites, and asks you to rewrite it - nothing in
a brief may ask its slice for a file the slice may not touch.

## A domain change the UI calls

When this story changes an exported function, method or constant that files
under `src/routes/`, `src/lib/components/` or `src/lib/ui/` already call,
find those callers first (`grep -rl <name> src/routes src/lib/components
src/lib/ui`) and list every such changed export in the domain slice's
`ui_called_exports`. The driver then requires that slice to stay additive -
the new shape beside the old one, or a new optional parameter that changes
no existing call - and hands the call sites to the `ui` slice, which runs
after it and adopts the new API. Do not write that instruction into the
brief yourself; the driver appends it.

Every other slice sends `ui_called_exports: []`. A `ui` or `workflow` slice
always does, and so does a domain slice whose change no UI file calls.

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
  criteria), test_kind (vitest for a domain slice, playwright for a ui
  slice, pytest for a workflow slice), and ui_called_exports (the changed
  exports the UI already calls, empty for every slice but an additive
  domain one).
