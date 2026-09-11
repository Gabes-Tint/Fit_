Same story, #$story_number "$story_title" - decide how to slice it for
implementation.

Fit_ slices at the layer boundary: domain logic (pure TypeScript under
src/lib) and UI (Svelte components/routes) are built and tested separately,
because they need different reviewers and different test kinds (vitest for
domain, playwright for UI).

Does this story's work span both a domain-logic change and a UI change, or
does it sit entirely in one layer?

Reply with the schema fields: spans_domain_and_ui (true or false), and slices

- exactly one slice if spans_domain_and_ui is false, exactly two (one layer
  "domain", one layer "ui", in that order) if it is true. Each slice needs:
  layer (domain or ui), title (short), brief (what to build, for whoever
  implements it), acceptance (a list of observable, testable criteria), and
  test_kind (vitest for a domain slice, playwright for a ui slice).
