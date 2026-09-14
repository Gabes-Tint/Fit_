# Planner: correct the rejected slicing reply

Continue in the same session for story #$story_number "$story_title"; the
same story, the same schema. The driver rejected your previous reply: one of
its briefs asked its slice to change files that slice's layer forbids. The
diagnostic below is quoted verbatim from that rejection.

"$diagnostic"

Rewrite only what it names and keep everything that already validated - the
same layers, in the same order, the same titles, acceptance criteria and
test kinds.

The layer boundaries, which no brief may cross:

- a `domain` slice may never change `src/routes/`, `src/lib/components/` or
  `src/lib/ui/`
- a `ui` slice may never change `src/lib/domain/`, `src/lib/server/` or
  `src/lib/state/`, unless the domain slice of the same story lists
  `ui_called_exports`, in which case the ui slice adopts that new API and
  those areas are its own work
- a `workflow` slice may change only `workflow/**`, `docs/**` and
  `cspell.json`

When the domain change alters an export the UI calls, the repair is never to
tell one slice to cross the boundary. Name those exports in the domain
slice's `ui_called_exports` and leave the callers out of its brief: the
driver makes that slice additive and gives the call sites to the ui slice.

Reply with the same schema fields: spans_domain_and_ui, and slices, each
with layer, title, brief, acceptance, test_kind and ui_called_exports.
