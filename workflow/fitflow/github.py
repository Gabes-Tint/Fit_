"""The only module that shells out to `gh`. Always `-R <repo>`, always parses
`--json` output in Python - never `--jq`, so a test's fake `gh` need only
implement plain JSON in and plain JSON/text out.
"""

import json
import os
import re
import subprocess
import time
from dataclasses import dataclass

from fitflow import narrate, settings

FIELDS = "number,title,body,labels,state,assignees"

# Signatures of a transient `gh` failure worth one retry, rather than a
# real problem the run should stop for. Wording taken from gh's own
# messages: a GitHub-side 5xx ("Something went wrong while executing your
# query"), an HTTP 5xx status, a network hiccup, or a rate limit.
TRANSIENT_SIGNATURES = (
    r"something went wrong while executing your query",
    r"http[ /]?5\d\d",
    r"\b50[234]\b",
    r"timed?\s?out",
    r"connection reset",
    r"could not resolve host",
    r"rate limit",
)
_TRANSIENT_PATTERN = re.compile("|".join(TRANSIENT_SIGNATURES), re.IGNORECASE)


def is_transient(message: str) -> bool:
    """Whether a `gh` failure's own text looks like a passing external
    blip rather than a real problem - shared with `agents.py` so an aarmy
    backend error carrying the same wording gets the same one retry."""
    return bool(_TRANSIENT_PATTERN.search(message))


def _retry_narration(subcommand: str, message: str) -> None:
    first_line = message.splitlines()[0] if message else message
    narrate.line(f"🔁 gh {subcommand} failed transiently, retrying once: {first_line}")


@dataclass
class Story:
    number: int
    title: str
    body: str
    labels: list[str]
    state: str
    assignees: list[str]


def _gh(*args: str) -> subprocess.CompletedProcess:
    """Run one `gh` subcommand, plain, no interpretation of its exit."""
    return subprocess.run(
        ["gh", *args, "-R", settings.FIT_GITHUB_REPO],
        capture_output=True,
        text=True,
    )


def _failure_text(result: subprocess.CompletedProcess) -> str:
    return result.stderr.strip() or result.stdout.strip()


def _run(*args: str) -> str:
    """Run one `gh` subcommand, retrying once after
    `settings.TRANSIENT_RETRY_SECONDS` when the first attempt fails with a
    transient signature. Any other failure raises immediately."""
    result = _gh(*args)
    if result.returncode == 0:
        return result.stdout
    message = _failure_text(result)
    if not is_transient(message):
        raise RuntimeError(f"gh {' '.join(args)} failed: {message}")
    _retry_narration(args[0] if args else "", message)
    time.sleep(settings.TRANSIENT_RETRY_SECONDS)
    result = _gh(*args)
    if result.returncode == 0:
        return result.stdout
    raise RuntimeError(f"gh {' '.join(args)} failed: {_failure_text(result)}")


def _api(endpoint: str) -> subprocess.CompletedProcess:
    return subprocess.run(
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


def _api_pages(endpoint: str) -> list[dict]:
    """Fetch every REST page. `--slurp` makes the output one JSON array of
    pages so pagination boundaries cannot affect context ordering. Retries
    once on a transient failure, same policy as `_run`."""
    result = _api(endpoint)
    if result.returncode != 0:
        message = _failure_text(result)
        if not is_transient(message):
            raise RuntimeError(f"gh api {endpoint} failed: {message}")
        _retry_narration(f"api {endpoint}", message)
        time.sleep(settings.TRANSIENT_RETRY_SECONDS)
        result = _api(endpoint)
        if result.returncode != 0:
            raise RuntimeError(f"gh api {endpoint} failed: {_failure_text(result)}")
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


def remove_label(number: int, label: str) -> None:
    _run("issue", "edit", str(number), "--remove-label", label)


def close_issue(number: int, comment: str) -> None:
    _run("issue", "close", str(number), "--comment", comment)


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


def _pr_number_for_head(head: str) -> int | None:
    """The open PR already carrying `head`, if one exists - checked before
    a retried `pr create`, since a transient failure may have landed after
    the write actually happened."""
    result = _gh("pr", "list", "--head", head, "--state", "open", "--json", "number")
    if result.returncode != 0:
        return None
    rows = json.loads(result.stdout or "[]")
    return rows[0]["number"] if rows else None


def create_pr(title: str, body: str, head: str) -> int:
    """Open a PR from `head` at the repository's default branch. `gh pr
    create` prints the URL; the number is its trailing path segment.

    A transient failure is retried once, but only after checking whether
    the first attempt actually created the PR (the 5xx could have arrived
    after GitHub's write) - so the retry never opens a duplicate."""
    args = ("pr", "create", "--title", title, "--body", body, "--head", head)
    result = _gh(*args)
    if result.returncode == 0:
        return int(result.stdout.strip().rsplit("/", 1)[-1])
    message = _failure_text(result)
    if not is_transient(message):
        raise RuntimeError(f"gh {' '.join(args)} failed: {message}")
    _retry_narration("pr create", message)
    time.sleep(settings.TRANSIENT_RETRY_SECONDS)
    existing = _pr_number_for_head(head)
    if existing is not None:
        return existing
    result = _gh(*args)
    if result.returncode == 0:
        return int(result.stdout.strip().rsplit("/", 1)[-1])
    raise RuntimeError(f"gh {' '.join(args)} failed: {_failure_text(result)}")


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
    Any other exit is a real gh failure, retried once if transient."""
    result = _pr_checks_once(number)
    if result.returncode not in (0, 1, 8):
        message = _failure_text(result)
        if is_transient(message):
            _retry_narration("pr checks", message)
            time.sleep(settings.TRANSIENT_RETRY_SECONDS)
            result = _pr_checks_once(number)
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
        f"gh pr checks {number} failed (exit {result.returncode}): {_failure_text(result)}"
    )


def _pr_checks_once(number: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["gh", "pr", "checks", str(number), "--json", "name,state", "-R", settings.FIT_GITHUB_REPO],
        capture_output=True,
        text=True,
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
    """Merge through the merge queue: no strategy flag, never update-branch.

    A transient failure is retried once, but only after checking whether
    the PR already merged - the queue can accept the merge and then answer
    the CLI's own request with a 5xx."""
    args = ("pr", "merge", str(number))
    result = _gh(*args)
    if result.returncode == 0:
        return
    message = _failure_text(result)
    if not is_transient(message):
        raise RuntimeError(f"gh {' '.join(args)} failed: {message}")
    _retry_narration("pr merge", message)
    time.sleep(settings.TRANSIENT_RETRY_SECONDS)
    if view_pr(number).state == "MERGED":
        return
    result = _gh(*args)
    if result.returncode == 0:
        return
    raise RuntimeError(f"gh {' '.join(args)} failed: {_failure_text(result)}")


# --- The merge commit and main's own CI (block 5) ------------------------------


@dataclass
class Run:
    """One `ci.yml` workflow run, as `main-ci-gate.ts` reads them."""

    database_id: int
    event: str
    status: str  # queued, in_progress or completed
    conclusion: str | None  # success, failure, cancelled, ... while completed
    head_sha: str
    head_branch: str
    url: str


def merge_commit(number: int) -> str:
    """The commit a merged PR actually put on main. Not the integration
    branch's head: main takes squash merges, so what landed is a commit
    the driver never made. Empty when GitHub has not settled it yet."""
    out = _run("pr", "view", str(number), "--json", "mergeCommit")
    payload = json.loads(out).get("mergeCommit") or {}
    return payload.get("oid") or ""


@dataclass
class MergeRecord:
    """What the pull request itself says about the merge: the head commit
    it carried and the squash commit main took."""

    state: str
    head_sha: str
    merge_sha: str


def merge_record(number: int) -> MergeRecord:
    """The PR's own account of what landed. `headRefOid` is the only thing
    that ties a commit the driver pushed to the merge: main squashes, so no
    ancestry test in this clone can find that commit on main."""
    payload = json.loads(_run("pr", "view", str(number), "--json", "state,headRefOid,mergeCommit"))
    return MergeRecord(
        state=payload.get("state") or "",
        head_sha=payload.get("headRefOid") or "",
        merge_sha=(payload.get("mergeCommit") or {}).get("oid") or "",
    )


def ci_runs_for(sha: str) -> list[Run]:
    """Every `ci.yml` run GitHub reports for one commit, newest first.
    `--commit` matches on SHA alone, so the caller checks the branch per
    event exactly as `scripts/deploy/main-ci-gate.ts` does."""
    out = _run(
        "run",
        "list",
        "--workflow",
        "ci.yml",
        "--commit",
        sha,
        "--json",
        "databaseId,event,status,conclusion,headSha,headBranch,url",
    )
    return [
        Run(
            database_id=row.get("databaseId", 0),
            event=row.get("event", ""),
            status=row.get("status", ""),
            conclusion=row.get("conclusion"),
            head_sha=row.get("headSha", ""),
            head_branch=row.get("headBranch", ""),
            url=row.get("url", ""),
        )
        for row in json.loads(out or "[]")
    ]
