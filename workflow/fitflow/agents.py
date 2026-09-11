"""The only module that shells out to `aarmy`. talk() renders a prompt
template, sends one turn (always carrying the roster's backend/model/effort,
so a roster change against an already-created agent fails loudly through
aarmy's own config assertion rather than silently), narrates the prompt and
reply in full, and returns the schema-validated reply as a dict.

Teams themselves - creating or deleting them - are `fitflow.teams`'s job,
not this module's: this module only ever talks to agents already living in
a team `fitflow.teams` has ensured exists.
"""

import json
import os
import re
import string
import subprocess
import time
from pathlib import Path

from fitflow import narrate, settings
from fitflow.outcome import FlowFailure, Outcome

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
SCHEMAS_DIR = Path(__file__).resolve().parent / "schemas"

_SESSION_LINE = re.compile(r"^\[(?P<name>\S+) session=(?P<session>\S+)\]$")


def render_prompt(name: str, **subs: str) -> str:
    text = (PROMPTS_DIR / f"{name}.md").read_text()
    return string.Template(text).substitute(subs)


def talk(
    team: str,
    role: str,
    prompt_name: str,
    schema_name: str,
    attribute_failures_to: int | None = None,
    **subs: str,
) -> dict:
    """One agent turn: render prompts/<prompt_name>.md, send it to <role> on
    <team> validated against schemas/<schema_name>.json, narrate prompt and
    reply, and return the reply as a dict. Raises FlowFailure(AGENT_FAILED)
    on any non-zero exit or an unparsable reply."""
    agent = settings.ROSTER[role]
    prompt_text = render_prompt(prompt_name, **subs)
    label = f"{role} ({agent['backend']} · {agent['model']} · {agent['effort']})"
    narrate.line(f"🤖➡️  {label}")
    narrate.block(prompt_text.splitlines())
    started = time.monotonic()
    result = subprocess.run(
        [
            "aarmy",
            "talk",
            role,
            "--team",
            team,
            "-b",
            agent["backend"],
            "-m",
            agent["model"],
            "-e",
            agent["effort"],
            "--timeout",
            settings.TALK_TIMEOUT,
            "--schema",
            str(SCHEMAS_DIR / f"{schema_name}.json"),
            "-p",
            prompt_text,
        ],
        capture_output=True,
        text=True,
        env=_env(),
    )
    elapsed = time.monotonic() - started
    if result.returncode != 0:
        raise FlowFailure(
            Outcome.AGENT_FAILED,
            f"aarmy talk {role} --team {team} failed (exit {result.returncode}): "
            f"{result.stderr.strip() or result.stdout.strip()}",
            attribute_failures_to,
        )
    lines = result.stdout.splitlines()
    if not lines or not _SESSION_LINE.match(lines[0]):
        raise FlowFailure(
            Outcome.AGENT_FAILED,
            f"aarmy talk {role} --team {team}: unexpected reply shape: {result.stdout!r}",
            attribute_failures_to,
        )
    reply_json = "\n".join(lines[1:])
    reply = json.loads(reply_json)
    narrate.line(f"🤖⬅️  {role} replied in {_format_duration(elapsed)}")
    narrate.raw_json(reply_json)
    return reply


def existing_roles(team: str) -> list[str] | None:
    """The role names `aarmy list agents --team <team>` already knows about,
    for narration only - None (rather than a guess) if the listing cannot
    be read."""
    result = subprocess.run(
        ["aarmy", "list", "agents", "--team", team],
        capture_output=True,
        text=True,
        env=_env(),
    )
    if result.returncode != 0:
        return None
    roles = []
    for raw_line in result.stdout.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("registry:") or stripped == "no agents":
            continue
        roles.append(stripped.split()[0])
    return roles


def _format_duration(seconds: float) -> str:
    total = int(seconds)
    minutes, secs = divmod(total, 60)
    if minutes:
        return f"{minutes}m{secs:02d}s"
    return f"{secs}s"


def _env() -> dict:
    env = dict(os.environ)
    env["AGENTS_ARMY_TEAMS_DIR"] = str(settings.TEAMS_DIR)
    return env
