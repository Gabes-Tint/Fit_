"""The fake world every end-to-end test runs go.py against: a real git
`origin` + clone, and fake `gh`/`aarmy`/`bun` on PATH driven by world.json.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

FAKES_DIR = Path(__file__).parent / "fakes"
WORKFLOW_DIR = Path(__file__).parent.parent
GO_PY = WORKFLOW_DIR / "go.py"
GABRIEL_LOGIN = "gabepsilva"


def _git(*args: str, cwd: Path) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    assert result.returncode == 0, f"git {args}: {result.stderr}"
    return result.stdout


class FakeWorld:
    """A story tracker (`gh`), an agent roster (`aarmy`), and a real git repo
    (`FIT_REPO`) with an `origin` remote, all rooted under one tmp_path.
    """

    def __init__(self, tmp_path: Path):
        self.dir = tmp_path / "fake-world"
        self.dir.mkdir()
        self.origin = tmp_path / "origin.git"
        self.repo = tmp_path / "repo"
        self.home = tmp_path / "flow-home"
        self.agent_config = self.dir / "agents.yaml"
        self.world = {"issues": {}, "next_issue_number": 1000, "turns": {}, "test_outcomes": {}}
        self._init_git()
        self.given_agent_config(
            """planner:
  backend: claude
  model: opus
  effort: medium
mechanic:
  backend: claude
  model: haiku
  effort: low
"""
        )
        self._save()

    def _init_git(self) -> None:
        _git("init", "--bare", "-b", "main", str(self.origin), cwd=self.origin.parent)
        _git("clone", str(self.origin), str(self.repo), cwd=self.origin.parent)
        _git("config", "user.email", "test@example.com", cwd=self.repo)
        _git("config", "user.name", "Test", cwd=self.repo)
        (self.repo / "README.md").write_text("seed\n")
        _git("add", "README.md", cwd=self.repo)
        _git("commit", "-m", "seed", cwd=self.repo)
        _git("push", "-u", "origin", "main", cwd=self.repo)

    def _save(self) -> None:
        (self.dir / "world.json").write_text(json.dumps(self.world, indent=2))

    def _load(self) -> None:
        self.world = json.loads((self.dir / "world.json").read_text())

    # --- given ---------------------------------------------------------

    def given_agent_config(self, text: str) -> None:
        self.agent_config.write_text(text)

    def given_story(
        self,
        number: int,
        title: str = "A story",
        body: str = "",
        labels: list[str] | None = None,
        state: str = "OPEN",
        assignees: list[str] | None = None,
    ) -> None:
        self._load()
        self.world["issues"][str(number)] = {
            "title": title,
            "body": body,
            "labels": list(labels) if labels is not None else ["story"],
            "state": state,
            "assignees": list(assignees) if assignees is not None else [],
            "comments": [],
        }
        self._save()

    def given_comment(
        self, number: int, body: str, author: str, created_at: str, comment_id: int = 1
    ) -> None:
        self._load()
        self.world["issues"][str(number)].setdefault("api_comments", []).append(
            {
                "id": comment_id,
                "body": body,
                "created_at": created_at,
                "user": {"login": author},
                "html_url": f"https://example.test/issues/{number}#issuecomment-{comment_id}",
            }
        )
        self._save()

    def given_timeline_event(self, number: int, **event) -> None:
        self._load()
        self.world["issues"][str(number)].setdefault("timeline", []).append(event)
        self._save()

    def planner_answers_whose_call(self, story_number: int, **reply) -> None:
        self._queue_turn(f"plan-{story_number}/planner", reply)

    def planner_answers_slices(self, story_number: int, **reply) -> None:
        self._queue_turn(f"plan-{story_number}/planner", reply)

    def planner_fails(self, story_number: int, message: str = "planner turn failed") -> None:
        self._queue_turn(f"plan-{story_number}/planner", None, exit_code=1, message=message)

    def mechanic_writes(
        self,
        slug: str,
        files: dict[str, str],
        test_files: list[str],
        why: str = "the behavior is not implemented yet",
        push: bool = True,
        commit: bool = True,
        rendezvous: str | None = None,
    ) -> None:
        self._queue_turn(
            f"{slug}/mechanic",
            {"test_files": test_files, "why_they_fail": why},
            effects={
                "files": files,
                "commit": commit,
                "push": push,
                "commit_message": f"test: failing acceptance tests for #{slug.split('-')[1]}",
            },
            rendezvous=rendezvous,
        )

    def mechanic_fails(
        self,
        slug: str,
        message: str,
        rendezvous: str | None = None,
        files: dict[str, str] | None = None,
    ) -> None:
        self._queue_turn(
            f"{slug}/mechanic",
            None,
            exit_code=1,
            message=message,
            effects={"files": files} if files else None,
            rendezvous=rendezvous,
        )

    def mechanic_replies(
        self,
        slug: str,
        test_files: list[str],
        why: str = "the behavior is not implemented yet",
    ) -> None:
        self._queue_turn(
            f"{slug}/mechanic",
            {"test_files": test_files, "why_they_fail": why},
        )

    def mechanic_changes_without_pushing(
        self, slug: str, files: dict[str, str], test_files: list[str]
    ) -> None:
        self.mechanic_writes(slug, files, test_files, push=False)

    def gh_fails_on(self, *substrings: str) -> None:
        """Any `gh` call whose argv (joined) contains one of these
        substrings exits 1 instead of doing anything - simulating gh going
        down mid-run."""
        self._load()
        self.world.setdefault("gh_failures", []).extend(substrings)
        self._save()

    def scripted_test_outcome(self, file: str, outcome: str = "fail") -> None:
        """Outcome: fail, pass, import_error, not_found, or tool_error."""
        self._load()
        self.world.setdefault("test_outcomes", {})[file] = outcome
        self._save()

    def _queue_turn(
        self,
        key: str,
        reply: dict | None,
        exit_code: int = 0,
        message: str = "",
        effects: dict | None = None,
        rendezvous: str | None = None,
    ) -> None:
        self._load()
        turn = {"exit": exit_code}
        if effects is not None:
            turn["effects"] = effects
        if exit_code == 0:
            turn["reply"] = reply
        else:
            turn["message"] = message
        if rendezvous is not None:
            turn["rendezvous"] = rendezvous
        self.world.setdefault("turns", {}).setdefault(key, []).append(turn)
        self._save()

    # --- then ------------------------------------------------------------

    def issue(self, number: int) -> dict:
        self._load()
        return self.world["issues"][str(number)]

    def calls(self) -> list[dict]:
        path = self.dir / "calls.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def branch_exists_on_origin(self, branch: str) -> bool:
        result = subprocess.run(
            ["git", "ls-remote", "--exit-code", "origin", branch],
            cwd=self.repo,
            capture_output=True,
        )
        return result.returncode == 0

    def planner_worktree_path(self, story_number: int) -> Path:
        return self.repo / ".claude" / "worktrees" / f"plan-{story_number}"

    def slice_worktree_path(self, slug: str) -> Path:
        return self.repo / ".claude" / "worktrees" / slug


@pytest.fixture
def world(tmp_path: Path) -> FakeWorld:
    return FakeWorld(tmp_path)


def run_flow(
    world: FakeWorld,
    *args: str,
    cwd: Path | None = None,
    config_path: Path | None = None,
    use_default_config: bool = False,
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PATH"] = f"{FAKES_DIR}:{env['PATH']}"
    env["FAKE_WORLD"] = str(world.dir)
    env["FIT_REPO"] = str(world.repo)
    env["FIT_GITHUB_REPO"] = "Gabes-Tint/Fit_"
    env["FIT_FLOW_HOME"] = str(world.home)
    if not use_default_config:
        env["FIT_FLOW_AGENT_CONFIG"] = str(config_path or world.agent_config)
    else:
        env.pop("FIT_FLOW_AGENT_CONFIG", None)
    return subprocess.run(
        [sys.executable, str(GO_PY), *args],
        cwd=cwd or WORKFLOW_DIR,
        capture_output=True,
        text=True,
        env=env,
    )
