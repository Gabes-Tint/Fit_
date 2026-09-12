"""The only module that shells out to `gh`. Always `-R <repo>`, always parses
`--json` output in Python - never `--jq`, so a test's fake `gh` need only
implement plain JSON in and plain JSON/text out.
"""

import json
import os
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


def _api_pages(endpoint: str) -> list[dict]:
    """Fetch every REST page. `--slurp` makes the output one JSON array of
    pages so pagination boundaries cannot affect context ordering."""
    result = subprocess.run(
        [
            "gh",
            "api",
            endpoint,
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
            "--paginate",
            "--slurp",
        ],
        capture_output=True,
        text=True,
        env={**os.environ, "GH_REPO": settings.FIT_GITHUB_REPO},
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"gh api {endpoint} failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    return [item for page in json.loads(result.stdout) for item in page]


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
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        settings.STORY_LABEL,
        "--limit",
        "1000",
        "--json",
        FIELDS,
    )
    stories = [_story_from_json(row) for row in json.loads(out)]
    return sorted(stories, key=lambda story: story.number)


def view(number: int) -> Story:
    out = _run("issue", "view", str(number), "--json", FIELDS)
    return _story_from_json(json.loads(out))


def comments(number: int) -> list[dict]:
    return _api_pages(f"repos/{settings.FIT_GITHUB_REPO}/issues/{number}/comments?per_page=100")


def timeline(number: int) -> list[dict]:
    return _api_pages(f"repos/{settings.FIT_GITHUB_REPO}/issues/{number}/timeline?per_page=100")


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


# --- Pull requests and checks (block 4) --------------------------------------


@dataclass
class PullRequest:
    number: int
    state: str
    head_ref: str


@dataclass
class Check:
    name: str
    state: str  # SUCCESS, FAILURE, PENDING or SKIPPED


def create_pr(title: str, body: str, head: str) -> int:
    """Open a PR from `head` at the repository's default branch. `gh pr
    create` prints the URL; the number is its trailing path segment."""
    url = _run("pr", "create", "--title", title, "--body", body, "--head", head).strip()
    return int(url.rsplit("/", 1)[-1])


def view_pr(number: int) -> PullRequest:
    out = _run("pr", "view", str(number), "--json", "number,state,headRefName")
    payload = json.loads(out)
    return PullRequest(
        number=payload["number"], state=payload["state"], head_ref=payload["headRefName"]
    )


def pr_checks(number: int) -> list[Check]:
    """The PR's checks. Parsed from `gh pr checks --json name,state`, whose
    state is one of SUCCESS, SKIPPED, NEUTRAL, FAILURE, CANCELLED,
    TIMED_OUT, PENDING, IN_PROGRESS or QUEUED.

    `gh pr checks` exits 8 when checks are pending or failing - that is a
    normal answer, not an error, and the JSON it prints is still the
    verdict. Exit 1 before CI has registered any check ("no checks
    reported") is also normal moments after a PR opens; the caller polls.
    Any other exit is a real gh failure."""
    result = subprocess.run(
        ["gh", "pr", "checks", str(number), "--json", "name,state", "-R", settings.FIT_GITHUB_REPO],
        capture_output=True,
        text=True,
    )
    if result.returncode in (0, 1, 8):
        if result.returncode == 1 and not result.stdout.strip():
            # "no checks reported on the '<branch>' branch": CI has not
            # registered anything yet; the caller polls
            return []
        try:
            rows = json.loads(result.stdout)
        except ValueError as error:
            raise RuntimeError(
                f"gh pr checks {number} printed unparsable output: {result.stdout!r}"
            ) from error
        return [Check(row["name"], row["state"]) for row in rows]
    raise RuntimeError(
        f"gh pr checks {number} failed (exit {result.returncode}): "
        f"{result.stderr.strip() or result.stdout.strip()}"
    )


def failed_run(branch: str) -> int | None:
    """The database id of the branch's most recent check run, or None."""
    out = _run(
        "run",
        "list",
        "--branch",
        branch,
        "--limit",
        "1",
        "--json",
        "databaseId,status,conclusion",
    )
    rows = json.loads(out)
    return rows[0]["databaseId"] if rows else None


def rerun_failed_runs(run_id: int) -> None:
    _run("run", "rerun", "--failed", str(run_id))


def merge_pr(number: int) -> None:
    """Merge through the merge queue: no strategy flag, never update-branch."""
    _run("pr", "merge", str(number))
