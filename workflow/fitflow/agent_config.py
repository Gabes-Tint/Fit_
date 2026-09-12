"""Strict loading for workflow/agents.yaml, independent of caller cwd."""

from dataclasses import dataclass
from pathlib import Path

import yaml

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "agents.yaml"
ROLES = {"planner", "mechanic", "builder", "solver"}
KEYS = {"backend", "model", "effort"}
BACKENDS = {"claude", "codex", "grok", "opencode"}
EFFORTS_BY_BACKEND = {
    "claude": {"low", "medium", "high", "xhigh", "max"},
}


class AgentConfigError(ValueError):
    pass


@dataclass(frozen=True)
class AgentConfig:
    backend: str
    model: str
    effort: str


def load(path: Path = DEFAULT_PATH) -> dict[str, AgentConfig]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise AgentConfigError(f"cannot read {path}: {error.strerror or error}") from error
    try:
        payload = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise AgentConfigError(f"invalid YAML in {path}: {error}") from error
    if not isinstance(payload, dict):
        raise AgentConfigError(f"{path}: top level must be a mapping")
    _exact_keys(payload, ROLES, str(path), "roles")
    return {role: _role(role, payload[role], path) for role in sorted(ROLES)}


def _role(role: str, payload: object, path: Path) -> AgentConfig:
    where = f"{path}: role {role}"
    if not isinstance(payload, dict):
        raise AgentConfigError(f"{where} must be a mapping")
    _exact_keys(payload, KEYS, where, "keys")
    values = {key: _nonempty_string(payload[key], f"{where}.{key}") for key in KEYS}
    if values["backend"] not in BACKENDS:
        raise AgentConfigError(
            f"{where}.backend must be one of {', '.join(sorted(BACKENDS))}; "
            f"got {values['backend']!r}"
        )
    valid_efforts = EFFORTS_BY_BACKEND.get(values["backend"])
    if valid_efforts is not None and values["effort"] not in valid_efforts:
        raise AgentConfigError(
            f"{where}.effort for backend {values['backend']} must be one of "
            f"{', '.join(sorted(valid_efforts))}; "
            f"got {values['effort']!r}"
        )
    return AgentConfig(values["backend"], values["model"], values["effort"])


def _exact_keys(payload: dict, expected: set[str], where: str, label: str) -> None:
    if any(not isinstance(key, str) for key in payload):
        raise AgentConfigError(f"{where}: {label} must be strings")
    actual = set(payload)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing {label}: {', '.join(missing)}")
        if extra:
            details.append(f"extra {label}: {', '.join(extra)}")
        raise AgentConfigError(f"{where}: {'; '.join(details)}")


def _nonempty_string(value: object, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AgentConfigError(f"{where} must be a non-empty string")
    return value.strip()
