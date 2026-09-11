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
    `home` doubles as `FIT_FLOW_HOME` and `AGENTS_ARMY_TEAMS_DIR`, so each
    issue's team lives at `home/issue-<n>`.
    """

    def __init__(self, tmp_path: Path):
        self.dir = tmp_path / "fake-world"
        self.dir.mkdir()
        self.origin = tmp_path / "origin.git"
        self.repo = tmp_path / "repo"
        self.home = tmp_path / "flow-home"
        self.world = {"issues": {}, "next_issue_number": 1000, "turns": {}, "test_outcomes": {}}
        self._init_git()
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

    def planner_answers_whose_call(self, story_number: int, **reply) -> None:
        self._queue_turn(f"issue-{story_number}/planner", reply)

    def planner_answers_slices(self, story_number: int, **reply) -> None:
        self._queue_turn(f"issue-{story_number}/planner", reply)

    def planner_fails(self, story_number: int, message: str = "planner turn failed") -> None:
        self._queue_turn(f"issue-{story_number}/planner", None, exit_code=1, message=message)

    def planner_leaves_a_file(self, story_number: int, path: str, content: str = "oops\n") -> None:
        """The scripted turn commits nothing - the file is just left dirty
        in the worktree, breaking the driver's post-turn clean check."""
        self._queue_turn(
            f"issue-{story_number}/planner",
            None,
            effects_only={"files": {path: content}},
        )

    def mechanic_writes(
        self,
        team_name: str,
        files: dict[str, str],
        test_files: list[str],
        why: str = "the behavior is not implemented yet",
        push: bool = True,
        commit: bool = True,
    ) -> None:
        number = team_name.split("-")[1]
        self._queue_turn(
            f"{team_name}/mechanic",
            {"test_files": test_files, "why_they_fail": why},
            effects={
                "files": files,
                "commit": commit,
                "push": push,
                "commit_message": f"test: failing acceptance tests for #{number}",
            },
        )

    def mechanic_changes_without_pushing(
        self, team_name: str, files: dict[str, str], test_files: list[str]
    ) -> None:
        self.mechanic_writes(team_name, files, test_files, push=False)

    def gh_fails_on(self, *substrings: str) -> None:
        """Any `gh` call whose argv (joined) contains one of these
        substrings exits 1 instead of doing anything - simulating gh going
        down mid-run."""
        self._load()
        self.world.setdefault("gh_failures", []).extend(substrings)
        self._save()

    def scripted_test_outcome(self, file: str, outcome: str = "fail") -> None:
        """outcome is "fail" (good - no implementation yet), "pass" (bad),
        or "not_found" (the runner never ran this file at all)."""
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
        effects_only: dict | None = None,
    ) -> None:
        """effects_only queues a turn whose reply the driver never reaches -
        the effects apply, but no "reply" key is written, matching a
        planner turn the driver rejects before parsing it (a dirty
        worktree)."""
        self._load()
        turn = {"exit": exit_code}
        if effects_only is not None:
            turn["effects"] = effects_only
            turn["reply"] = reply or {}
        elif exit_code == 0:
            turn["reply"] = reply
            if effects is not None:
                turn["effects"] = effects
        else:
            turn["message"] = message
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

    def issue_worktree_path(self, number: int) -> Path:
        return self.repo / ".claude" / "worktrees" / f"issue-{number}"

    def team_dir(self, number: int) -> Path:
        return self.home / f"issue-{number}"


@pytest.fixture
def world(tmp_path: Path) -> FakeWorld:
    return FakeWorld(tmp_path)


def run_flow(
    world: FakeWorld, *args: str, spend_flagged_env: bool = False
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PATH"] = f"{FAKES_DIR}:{env['PATH']}"
    env["FAKE_WORLD"] = str(world.dir)
    env["FIT_REPO"] = str(world.repo)
    env["FIT_GITHUB_REPO"] = "Gabes-Tint/Fit_"
    env["FIT_FLOW_HOME"] = str(world.home)
    env["FIT_FLOW_SPEND_FLAGGED"] = "1" if spend_flagged_env else ""
    return subprocess.run(
        [sys.executable, str(GO_PY), *args],
        cwd=WORKFLOW_DIR,
        capture_output=True,
        text=True,
        env=env,
    )
