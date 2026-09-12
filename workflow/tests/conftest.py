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

# Block 5's deploy targets. Never real names: the driver refuses to start
# without them, and the point of the assertions is that the exact strings
# the environment carried reach `bun run deploy` unchanged.
QA_HOST = "deploy@qa.invalid"
QA_ORIGIN = "https://qa.invalid"
PROD_HOST = "deploy@prod.invalid"
PROD_ORIGIN = "https://prod.invalid"
HOSTS = {"qa": QA_HOST, "prod": PROD_HOST}

SIGNAL_NAMES = (
    "objective_clear",
    "area_known",
    "pattern_known",
    "procedure_complete",
    "solution_uncertain",
    "cause_uncertain",
    "technical_choice",
    "sensitive_areas",
    "human_decision",
)


def mechanic_signals(**overrides) -> dict:
    """Fully determined slice: selection row 4."""
    signals = dict(
        objective_clear=True,
        area_known=True,
        pattern_known=True,
        procedure_complete=True,
        solution_uncertain=False,
        cause_uncertain=False,
        technical_choice="none",
        sensitive_areas=[],
        human_decision=False,
    )
    signals.update(overrides)
    return signals


def builder_signals(**overrides) -> dict:
    return mechanic_signals(procedure_complete=False, **overrides)


def solver_signals(**overrides) -> dict:
    return mechanic_signals(solution_uncertain=True, **overrides)


def _evidence(story_number: int, layer: str, signals: dict) -> list[dict]:
    base = f"run-{story_number}/{layer}"
    refs = {
        "objective_clear": f"{base}/brief",
        "area_known": f"{base}/brief",
        "pattern_known": f"{base}/brief",
        "procedure_complete": f"{base}/brief",
        "solution_uncertain": f"{base}/issue_context",
        "cause_uncertain": f"{base}/issue_context",
        "technical_choice": f"{base}/brief",
        "sensitive_areas": f"{base}/failing_tests",
        "human_decision": f"run-{story_number}/ownership",
    }
    return [
        {"signal": name, "source_ref": refs[name], "detail": "scripted evidence"}
        for name in SIGNAL_NAMES
    ]


def delegate_slice(story_number: int, layer: str, signals: dict) -> dict:
    return {
        "layer": layer,
        "signals": signals,
        "evidence": _evidence(story_number, layer, signals),
        "unresolved": [],
        "needs_sibling": False,
    }


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
        self.world = {
            "issues": {},
            "next_issue_number": 1000,
            "turns": {},
            "test_outcomes": {},
            "origin": str(self.origin),
            # `version-tag.yml` tags every merge; a scenario that wants an
            # untagged merge says so with `given_no_tag`
            "default_tag": "v0.0.1",
        }
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
builder:
  backend: claude
  model: sonnet
  effort: medium
solver:
  backend: claude
  model: opus
  effort: high
reviewer:
  backend: claude
  model: opus
  effort: high
"""
        )
        self._save()

    def _init_git(self) -> None:
        _git("init", "--bare", "-b", "main", str(self.origin), cwd=self.origin.parent)
        _git("clone", str(self.origin), str(self.repo), cwd=self.origin.parent)
        _git("config", "user.email", "test@example.com", cwd=self.repo)
        _git("config", "user.name", "Test", cwd=self.repo)
        (self.repo / "README.md").write_text("seed\n")
        (self.repo / ".gitignore").write_text("reports/\n")
        _git("add", "README.md", ".gitignore", cwd=self.repo)
        _git("commit", "-m", "seed", cwd=self.repo)
        _git("push", "-u", "origin", "main", cwd=self.repo)

    def _save(self) -> None:
        # atomic: the fake fakes read this file from their own processes, so a
        # torn read must be impossible
        path = self.dir / "world.json"
        tmp = path.with_suffix(f".json.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(self.world, indent=2))
        tmp.replace(path)

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

    def planner_answers_delegate(
        self, story_number: int, slices: list[dict], session: str | None = None
    ) -> None:
        """The block 2 signals turn: one proposal per slice. A session
        override scripts a backend that drifted out of the planner's
        conversation."""
        self._queue_turn(f"plan-{story_number}/planner", {"slices": slices}, session=session)

    def planner_keeps_rejecting(self, story_number: int, slices: list[dict]) -> None:
        """Queue the same invalid proposal three times: the planner's
        bounded corrective loop re-asks before the run stops."""
        for _ in range(3):
            self.planner_answers_delegate(story_number, slices)

    def agent_implements(
        self,
        slug: str,
        role: str,
        files: dict[str, str],
        changed_files: list[str],
        summary: str = "implemented the missing behavior",
        push: bool = False,
        commit: bool = False,
        rendezvous: str | None = None,
        session: str | None = None,
    ) -> None:
        """One implementation turn: the agent writes files into the worktree
        but never commits or pushes - the driver owns commits."""
        self._queue_turn(
            f"{slug}/{role}",
            {"changed_files": changed_files, "summary": summary},
            effects={"files": files, "commit": commit, "push": push},
            rendezvous=rendezvous,
            session=session,
        )

    def agent_fails(
        self,
        slug: str,
        role: str,
        message: str,
        files: dict[str, str] | None = None,
        rendezvous: str | None = None,
    ) -> None:
        self._queue_turn(
            f"{slug}/{role}",
            None,
            exit_code=1,
            message=message,
            effects={"files": files} if files else None,
            rendezvous=rendezvous,
        )

    def agent_replies_raw(self, slug: str, role: str, raw: str) -> None:
        """A successful exit with an unparsable reply body."""
        self._queue_turn(f"{slug}/{role}", None, raw_reply=raw)

    def agent_omits_session(self, slug: str, role: str, reply: dict) -> None:
        self._queue_turn(f"{slug}/{role}", reply, omit_session=True)

    def mechanic_writes(
        self,
        slug: str,
        files: dict[str, str],
        test_files: list[str],
        why: str = "the behavior is not implemented yet",
        push: bool = True,
        commit: bool = True,
        delete: list[str] | None = None,
        rendezvous: str | None = None,
    ) -> None:
        self._queue_turn(
            f"{slug}/mechanic",
            {"test_files": test_files, "why_they_fail": why},
            effects={
                "files": files,
                "delete": delete or [],
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

    # --- block 4 ---------------------------------------------------------

    def reviewer_answers(
        self, story_number: int, verdict: str = "merge", findings: list[dict] | None = None
    ) -> None:
        self._queue_turn(
            f"story-{story_number}-review/reviewer",
            {"verdict": verdict, "findings": findings or []},
        )

    def reviewer_fails(self, story_number: int, message: str = "reviewer turn failed") -> None:
        self._queue_turn(
            f"story-{story_number}-review/reviewer", None, exit_code=1, message=message
        )

    def reviewer_writes(self, story_number: int, files: dict[str, str]) -> None:
        """A reviewer turn that violates its read-only contract by writing
        to the integration worktree."""
        self._queue_turn(
            f"story-{story_number}-review/reviewer",
            {"verdict": "merge", "findings": []},
            effects={"files": files},
        )

    def given_checks(self, pr_number: int, outcomes: str | list[str]) -> None:
        """Scripted `gh pr checks` results for a PR: pass, fail, or pending.
        A list is consumed one value per invocation."""
        self._load()
        self.world.setdefault("check_outcomes", {})[f"pr-{pr_number}"] = outcomes
        self._save()

    # --- block 5 ---------------------------------------------------------

    def given_tag(self, name: str, pr_number: int | None = None) -> None:
        """The tag `version-tag.yml` puts on the merge commit."""
        self._load()
        if pr_number is None:
            self.world["default_tag"] = name
        else:
            self.world.setdefault("tags", {})[f"pr-{pr_number}"] = name
        self._save()

    def given_no_tag(self) -> None:
        """The merge lands and no tag ever appears."""
        self._load()
        self.world["default_tag"] = None
        self.world["tags"] = {}
        self._save()

    def given_main_ci(
        self,
        pr_number: int,
        push: str | list[str] | None = "success",
        merge_group: str | list[str] | None = None,
    ) -> None:
        """Main's own CI for the merge commit: one state per poll, per
        event, from queued, running, success, failure and cancelled. None
        means that event has no run at all."""
        self._load()
        runs = self.world.setdefault("main_ci", {})
        runs[f"pr-{pr_number}/push"] = push
        runs[f"pr-{pr_number}/merge_group"] = merge_group
        self._save()

    def given_deploy(self, target: str, outcome: str) -> None:
        """`bun run deploy` against the QA or prod host: ok, health_failed
        (no report written at all), smoke_failed, or wrong_release (a green
        report about some other commit)."""
        self._load()
        self.world.setdefault("deploy_outcomes", {})[HOSTS[target]] = outcome
        self._save()

    def given_android(self, outcome: str) -> None:
        self._load()
        self.world["android_outcome"] = outcome
        self._save()

    def given_worktree_done_fails(self, slug: str) -> None:
        """`worktree:done` refuses this slug even with --force."""
        self._load()
        self.world.setdefault("worktree_done_failures", []).append(slug)
        self._save()

    def gh_fails_on_comment_body(self, *substrings: str) -> None:
        """Any `gh issue comment` whose --body contains one of these
        substrings exits 1 - for failing one specific comment."""
        self._load()
        self.world.setdefault("gh_fail_on_body", []).extend(substrings)
        self._save()

    def scripted_test_outcome(self, file: str, outcome: str | list[str]) -> None:
        """Outcome: fail, pass, import_error, not_found, or tool_error.
        A list is consumed one value per runner invocation."""
        self._load()
        self.world.setdefault("test_outcomes", {})[file] = outcome
        self._save()

    def given_gate_outcomes(self, **outcomes) -> None:
        """Scripted results for `npm run <script>` and `bun run
        test:mutation:<lane>`: pass, fail, or tool_error. A list is
        consumed one value per invocation."""
        self._load()
        self.world.setdefault("gate_outcomes", {}).update(outcomes)
        self._save()

    def _queue_turn(
        self,
        key: str,
        reply: dict | None,
        exit_code: int = 0,
        message: str = "",
        effects: dict | None = None,
        rendezvous: str | None = None,
        session: str | None = None,
        omit_session: bool = False,
        raw_reply: str | None = None,
    ) -> None:
        self._load()
        turn = _turn_script(
            reply, exit_code, message, effects, rendezvous, session, omit_session, raw_reply
        )
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


def _turn_script(
    reply, exit_code, message, effects, rendezvous, session, omit_session, raw_reply
) -> dict:
    key = "reply" if exit_code == 0 else "message"
    turn = {"exit": exit_code, key: reply if exit_code == 0 else message}
    optional = {
        "effects": effects,
        "rendezvous": rendezvous,
        "session": session,
        "raw_reply": raw_reply,
    }
    for key, value in optional.items():
        if value is not None:
            turn[key] = value
    if omit_session:
        turn["omit_session"] = True
    return turn


@pytest.fixture
def world(tmp_path: Path) -> FakeWorld:
    return FakeWorld(tmp_path)


def run_flow(
    world: FakeWorld,
    *args: str | int,
    cwd: Path | None = None,
    config_path: Path | None = None,
    use_default_config: bool = False,
    env_extra: dict[str, str] | None = None,
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PATH"] = f"{FAKES_DIR}:{env['PATH']}"
    env["FAKE_WORLD"] = str(world.dir)
    env["FIT_REPO"] = str(world.repo)
    env["FIT_GITHUB_REPO"] = "Gabes-Tint/Fit_"
    env["FIT_FLOW_HOME"] = str(world.home)
    # the fake gh answers checks instantly; polling sleeps would only slow
    # the suite down
    env.setdefault("FIT_FLOW_CI_POLL_SECONDS", "0")
    env["FIT_FLOW_QA_DEPLOY_HOST"] = QA_HOST
    env["FIT_FLOW_QA_PUBLIC_ORIGIN"] = QA_ORIGIN
    env["FIT_FLOW_PROD_DEPLOY_HOST"] = PROD_HOST
    env["FIT_FLOW_PROD_PUBLIC_ORIGIN"] = PROD_ORIGIN
    if env_extra:
        env.update(env_extra)
    if not use_default_config:
        env["FIT_FLOW_AGENT_CONFIG"] = str(config_path or world.agent_config)
    else:
        env.pop("FIT_FLOW_AGENT_CONFIG", None)
    return subprocess.run(
        [sys.executable, str(GO_PY), *(str(arg) for arg in args)],
        cwd=cwd or WORKFLOW_DIR,
        capture_output=True,
        text=True,
        env=env,
    )
