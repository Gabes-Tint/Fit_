"""The only module that shells out to `gh`. Always `-R <repo>`, always parses
`--json` output in Python - never `--jq`, so a test's fake `gh` need only
implement plain JSON in and plain JSON/text out.
"""

import json
import subprocess
from dataclasses import dataclass

from fitflow import settings

FIELDS = "number,title,body,labels,state,assignees"


@dataclass
class Story:
    number: int
    title: str
    body: str
    labels: list[str]
    state: str
    assignees: list[str]


def _run(*args: str) -> str:
    result = subprocess.run(
        ["gh", *args, "-R", settings.FIT_GITHUB_REPO],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"gh {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout


def _story_from_json(payload: dict) -> Story:
    return Story(
        number=payload["number"],
        title=payload["title"],
        body=payload.get("body") or "",
        labels=[label["name"] for label in payload.get("labels", [])],
        state=payload["state"],
        assignees=[assignee["login"] for assignee in payload.get("assignees", [])],
    )


def list_open_stories() -> list[Story]:
    """Every open issue labelled `story`, lowest number first."""
    out = _run(
        "issue", "list", "--state", "open", "--label", settings.STORY_LABEL, "--json", FIELDS
    )
    stories = [_story_from_json(row) for row in json.loads(out)]
    return sorted(stories, key=lambda story: story.number)


def view(number: int) -> Story:
    out = _run("issue", "view", str(number), "--json", FIELDS)
    return _story_from_json(json.loads(out))


def add_label(number: int, label: str) -> None:
    _run("issue", "edit", str(number), "--add-label", label)


def assign(number: int, login: str) -> None:
    _run("issue", "edit", str(number), "--add-assignee", login)


def comment(number: int, body: str) -> None:
    _run("issue", "comment", str(number), "--body", body)


def create_issue(title: str, body: str, labels: list[str]) -> int:
    """Create an issue, returning its number. `gh issue create` prints the
    new issue's URL to stdout; the number is its trailing path segment."""
    args = ["issue", "create", "--title", title, "--body", body]
    for label in labels:
        args += ["--label", label]
    url = _run(*args).strip()
    return int(url.rsplit("/", 1)[-1])
