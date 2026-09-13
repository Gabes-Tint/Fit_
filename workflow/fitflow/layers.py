"""The two slice layers and their file boundaries, in one place.

The development flow has exactly two categories: "ui" means frontend/
interface work in Svelte components and routes; "domain" means every
non-UI change, including framework-free domain logic, server/backend code,
persistence, migrations and database work. The scope check reads only from
this module, so the constants and the validation cannot drift apart.
"""

UI_PREFIXES = ("src/routes/", "src/lib/components/", "src/lib/ui/")
DOMAIN_PREFIXES = ("src/lib/server/", "src/lib/domain/")

LAYERS = ("domain", "ui")


_NON_UI_PREFIXES = (*DOMAIN_PREFIXES, "src/lib/state/")


def rejects_for_layer(layer: str, path: str) -> str | None:
    """Why `path` is outside `layer`'s scope, or None when it belongs.

    A domain slice rejects everything under the UI areas - routes, Svelte
    components and shared UI modules, including their TypeScript loaders,
    server modules and helpers, not only .svelte files. A ui slice rejects
    everything under the explicitly non-UI areas: domain modules, server
    code and the store."""
    if layer == "domain":
        return _rejects_domain(path)
    if layer == "ui":
        return _rejects_ui(path)
    return f"unknown slice layer {layer!r}"


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
