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
"""

UI_PREFIXES = ("src/routes/", "src/lib/components/", "src/lib/ui/")
DOMAIN_PREFIXES = ("src/lib/server/", "src/lib/domain/")
#: Everything a workflow slice is allowed to change, plus `WORKFLOW_FILES`.
WORKFLOW_PREFIXES = ("workflow/", "docs/")
#: A driver pull request routinely adds a word to the spell-check
#: dictionary along with the prose that uses it, so `cspell.json` is inside
#: the workflow layer although it is a gate file for every other slice.
WORKFLOW_FILES = ("cspell.json",)

LAYERS = ("domain", "ui", "workflow")


_NON_UI_PREFIXES = (*DOMAIN_PREFIXES, "src/lib/state/")


def rejects_for_layer(layer: str, path: str) -> str | None:
    """Why `path` is outside `layer`'s scope, or None when it belongs.

    A domain slice rejects everything under the UI areas - routes, Svelte
    components and shared UI modules, including their TypeScript loaders,
    server modules and helpers, not only .svelte files. A ui slice rejects
    everything under the explicitly non-UI areas: domain modules, server
    code and the store. A workflow slice rejects everything outside the
    driver and its documentation."""
    if layer == "domain":
        return _rejects_domain(path)
    if layer == "ui":
        return _rejects_ui(path)
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


def _rejects_ui(path: str) -> str | None:
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
