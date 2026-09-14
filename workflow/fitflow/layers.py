"""The three slice layers and their file boundaries, in one place.

The development flow has three categories. "ui" means frontend/interface
work in Svelte components and routes; "domain" means every other change to
the product, including framework-free domain logic, server/backend code,
persistence, migrations and database work; "workflow" means a change to the
driver itself - the Python package under `workflow/` and the documentation
that describes it. The scope check reads only from this module, so the
constants and the validation cannot drift apart.

The workflow layer is the only one defined by an allowlist. `domain` and
`ui` partition the product tree and reject each other's areas; a workflow
slice may touch `workflow/`, `docs/` and the repository's `cspell.json`, and
everything else - `src/`, `scripts/`, `quality/`, `.github/` - is outside
it. The reason is the shape of a driver story: its code, its tests and the
prose describing it all live in two directories, and a slice that reached
out of them would be changing the product while claiming to change the
driver.

The briefs are here too, for the same reason the scope check is: a slice
told to edit files its layer forbids cannot obey both instructions, and
#422 stopped on exactly that - a domain brief that said "Update existing
callers so the app still compiles" about callers under `src/routes/`. The
prose a brief carries about its boundary is rendered from the constants the
check enforces, and the contradiction rule reads the same ones.
"""

import re

UI_PREFIXES = ("src/routes/", "src/lib/components/", "src/lib/ui/")
DOMAIN_PREFIXES = ("src/lib/server/", "src/lib/domain/")
#: The shared store. It belongs to neither product layer by itself - a `ui`
#: slice may not reach into it - but a `ui` slice that adopts its domain
#: sibling's new API edits it along with the domain modules.
STATE_PREFIX = "src/lib/state/"
#: Everything a workflow slice is allowed to change, plus `WORKFLOW_FILES`.
WORKFLOW_PREFIXES = ("workflow/", "docs/")
#: A driver pull request routinely adds a word to the spell-check
#: dictionary along with the prose that uses it, so `cspell.json` is inside
#: the workflow layer although it is a gate file for every other slice.
WORKFLOW_FILES = ("cspell.json",)

LAYERS = ("domain", "ui", "workflow")


_NON_UI_PREFIXES = (*DOMAIN_PREFIXES, STATE_PREFIX)
#: What a dependent `ui` slice may change beyond its own areas: the
#: store and the domain modules whose new API it adopts.
ADOPTED_PREFIXES = _NON_UI_PREFIXES


def rejects_for_layer(layer: str, path: str, adopts_domain: bool = False) -> str | None:
    """Why `path` is outside `layer`'s scope, or None when it belongs.

    A domain slice rejects everything under the UI areas - routes, Svelte
    components and shared UI modules, including their TypeScript loaders,
    server modules and helpers, not only .svelte files. A ui slice rejects
    everything under the explicitly non-UI areas: domain modules, server
    code and the store. A workflow slice rejects everything outside the
    driver and its documentation.

    `adopts_domain` is the one widening: the ui slice that runs after its
    domain sibling, on a tree that already carries it, adopts the new API
    at its call sites, and those call sites are in the store and the domain
    modules. Only a dependent ui slice gets it, and only because the domain
    slice it adopts was briefed to leave the old call shape working."""
    if layer == "domain":
        return _rejects_domain(path)
    if layer == "ui":
        return _rejects_ui(path, adopts_domain)
    if layer == "workflow":
        return _rejects_workflow(path)
    return f"unknown slice layer {layer!r}"


def permits_gate_file(layer: str, path: str) -> bool:
    """True for the few repository-wide files this layer owns although
    every other slice is forbidden them. Only the workflow layer has any:
    `cspell.json` travels with the driver's own prose."""
    return layer == "workflow" and path in WORKFLOW_FILES


def _rejects_domain(path: str) -> str | None:
    for prefix in UI_PREFIXES:
        if path.startswith(prefix):
            return f"domain slice changed a UI file: {path}"
    return None


def _rejects_ui(path: str, adopts_domain: bool = False) -> str | None:
    if adopts_domain:
        return None
    for prefix in _NON_UI_PREFIXES:
        if path.startswith(prefix):
            area = "the shared store" if prefix.startswith("src/lib/state/") else "a domain file"
            return f"ui slice changed {area} outside its scope: {path}"
    return None


def _rejects_workflow(path: str) -> str | None:
    if path.startswith(WORKFLOW_PREFIXES) or path in WORKFLOW_FILES:
        return None
    return (
        f"workflow slice changed a file outside the driver: {path} - a workflow slice "
        "may change only workflow/**, docs/** and cspell.json"
    )


#: A domain brief may not tell its slice to follow its change into the UI
#: areas, which it may not touch. Matched narrowly rather than read: a verb,
#: an optional article, and "callers" or "call sites" - the shape of #422's
#: "Update existing callers so the app still compiles".
_FOLLOW_THE_CALLERS = re.compile(
    r"\b(?:update|fix|adjust|migrate|change|switch|repair)\s+"
    r"(?:the\s+|all\s+|every\s+|its\s+|their\s+)?(?:existing\s+|remaining\s+|other\s+)?"
    r"call(?:er|-?\s?site)s?\b",
    re.IGNORECASE,
)

#: What the other layers' areas are called in a diagnostic.
_AREAS = {
    "domain": "the UI areas",
    "ui": "the store and the domain areas",
    "workflow": "the product tree",
}

_OUTSIDE_WORKFLOW = ("src/", "scripts/", "quality/", ".github/")


def forbidden_prefixes(layer: str, adopts_domain: bool = False) -> tuple[str, ...]:
    """The areas a slice of this layer may not change, as prefixes. The
    workflow layer is an allowlist, so what it may not change is named
    directly rather than derived."""
    if layer == "domain":
        return UI_PREFIXES
    if layer == "ui":
        return () if adopts_domain else _NON_UI_PREFIXES
    if layer == "workflow":
        return _OUTSIDE_WORKFLOW
    return ()


def brief_contradiction(layer: str, brief: str, adopts_domain: bool = False) -> str | None:
    """Why this brief instructs its slice to edit files the slice's own
    layer forbids, or None when it does not.

    Two mechanical rules, deliberately not a reading of the prose: a path
    under an area this layer may not change, named literally, and - in a
    domain brief - the instruction to follow the change into its callers.
    A brief that only wants to cite a UI file as context trips the first
    rule too; that costs the planner one corrective turn and is the price
    of a check that cannot be argued with. The sibling slice is where those
    files belong, and the brief can say so without naming them."""
    for prefix in forbidden_prefixes(layer, adopts_domain):
        if prefix in brief:
            return (
                f"the {layer} brief names {prefix}, which a {layer} slice may not change; "
                f"{_AREAS[layer]} belong to the other slice"
            )
    if layer == "domain":
        found = _FOLLOW_THE_CALLERS.search(brief)
        if found is not None:
            return (
                f'the domain brief says "{found.group(0)}", and the callers of a domain '
                f"export live in {_listed(UI_PREFIXES)}, which a domain slice may not "
                "change; brief this slice to keep the old call shape working instead, "
                "and leave the call sites to the ui slice"
            )
    return None


def additive_clause(exports: list[str]) -> str:
    """What a domain slice whose changed exports the UI calls is briefed
    to do instead of updating those callers."""
    return (
        f"Additive API: files under {_listed(UI_PREFIXES)} call {_listed(exports)}, and "
        "they are outside this slice's reach. Every existing call must still compile and "
        "still mean what it meant: add the new function beside the old one, or a new "
        "optional parameter that changes no existing call, rather than changing the shape "
        "the callers use. Do not touch the callers. The acceptance tests for this slice "
        "test the new API only; the ui slice runs after this one and adopts it."
    )


def adopt_clause() -> str:
    """What the dependent ui slice is briefed to do with the API its domain
    sibling left additive."""
    return (
        "Adopt and clean up: this slice runs on a tree that already carries the domain "
        f"slice, so besides the UI areas it may also change {_listed(ADOPTED_PREFIXES)}. "
        "Switch the call sites to the new API, then remove the compatibility shape the "
        "domain slice left behind once nothing else uses it. Its own acceptance tests "
        "stay UI tests."
    )


def scope_note(layer: str, exports: list[str], adopts_domain: bool = False) -> str:
    """The one-paragraph scope fact an implementation turn is told beyond
    the ordinary layer boundary, or an empty string when this slice has
    none. Rendered from the same constants the scope check reads."""
    if adopts_domain:
        return (
            "This slice runs on a tree that already carries its domain sibling, so "
            f"{_listed(ADOPTED_PREFIXES)} are inside its reach as well as the UI areas: "
            "adopting the new API at its call sites is this slice's own work."
        )
    if layer == "domain" and exports:
        return (
            f"{_listed(exports)} are called from {_listed(UI_PREFIXES)}, which are outside "
            "this slice's reach. Keep every existing call working: the ui slice adopts the "
            "new API afterwards."
        )
    return ""


def _listed(names) -> str:
    return ", ".join(f"`{name}`" for name in names)
