"""The run's exclusive story lock and its persisted lifecycle state.

A second `go.py` execution on the same story must fail without starting
workers: a held issue label alone is not an exclusive lock, so each run
holds a non-blocking flock on `locks/story-<n>.lock` for its whole life.

The state file `runs/story-<n>.json` is the run's retained record and its
slice state machines: block 1's slice identities (issue, branch, worktree,
team, failing-test commit, test files), the frozen startup configuration,
every assignment revision, attempt counters and turn identities. Every
transition persists before the next one is chosen. There is no resume
contract: an interrupted run leaves its state on disk for audit, and a
fresh run stops rather than replaying anything.
"""

import fcntl
import json
import os
import threading
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path

from fitflow import settings
from fitflow.outcome import FlowFailure, Outcome


def lock_path(story_number: int) -> Path:
    return settings.FIT_FLOW_HOME / "locks" / f"story-{story_number}.lock"


def state_path(story_number: int) -> Path:
    return settings.FIT_FLOW_HOME / "runs" / f"story-{story_number}.json"


@contextmanager
def story_lock(story_number: int):
    """Own the story exclusively for the rest of the run, or fail at once.
    The flock dies with the process; a killed run leaves no stale lock."""
    lock_path(story_number).parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path(story_number).open("w")
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise FlowFailure(
                Outcome.EXECUTION_HELD,
                f"another go.py run already owns story #{story_number} "
                f"({lock_path(story_number).name} is locked)",
            ) from error
        yield
    finally:
        handle.close()


def verify_exclusive(story_number: int) -> None:
    """Before a turn: the run's own flock must still be the only one on the
    story lock. A fresh exclusive acquire succeeding means ownership was
    lost; acquiring is refused while this run still holds the lock."""
    with lock_path(story_number).open("w") as probe:
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return  # still exclusively ours
        raise FlowFailure(
            Outcome.EXECUTION_HELD,
            f"exclusive ownership of story #{story_number} was lost mid-run",
            story_number,
        )


def verify_team_ownership(piece: "SliceRecord") -> None:
    """Before a turn: the AI Army team still owns exactly this slice's
    worktree. The team's `worktree` entry must be a symbolic link resolving
    to the retained slice worktree, inside the repository's expected
    worktree directory, with team/branch/slug/worktree identities all
    matching the retained record. A missing, replaced or redirected link
    means the team is not ours to launch."""
    from fitflow import worktrees

    link = settings.TEAMS_DIR / piece.team / "worktree"
    if not link.is_symlink():
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"team {piece.team} has no worktree link at {link}",
            piece.number,
        )
    target = link.resolve()
    expected = Path(piece.worktree).resolve()
    root = (settings.FIT_REPO / ".claude" / "worktrees").resolve()
    if root not in target.parents:
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"team {piece.team}'s worktree link resolves outside {root}: {target}",
            piece.number,
        )
    if target != expected:
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"team {piece.team}'s worktree link resolves to {target}, not the retained {expected}",
            piece.number,
        )
    if piece.team != piece.slug or piece.branch != piece.slug:
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"team/branch/slug identities disagree on {piece.slug}: "
            f"team={piece.team}, branch={piece.branch}",
            piece.number,
        )
    if Path(piece.worktree).resolve() != worktrees.slice_worktree_path(piece.slug).resolve():
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            f"retained worktree for {piece.slug} does not match its expected path: "
            f"{piece.worktree}",
            piece.number,
        )


# --- per-slice state machine -------------------------------------------------


@dataclass
class SliceRecord:
    """One slice's immutable block-1 identity plus its live block 2/3 state.

    assignments never mutates an accepted entry: escalation appends a new
    revision. attempts counts the current role's launches (0 before the
    first); escalations equals the assignment revision."""

    number: int
    layer: str
    title: str
    slug: str
    branch: str
    team: str
    worktree: str
    brief: str
    acceptance: list[str]
    test_kind: str
    test_files: list[str]
    failing_sha: str
    role: str = ""
    revision: int = 0
    attempts: int = 0
    state: str = "assigned"
    diagnostics: list[str] = field(default_factory=list)
    assignments: list[dict] = field(default_factory=list)
    turns: list[dict] = field(default_factory=list)
    frozen_commit: str = ""
    implementation_sha: str = ""

    def turn_identity(self, role: str, revision: int, attempt: int) -> dict:
        return {"layer": self.layer, "role": role, "revision": revision, "attempt": attempt}


@dataclass
class RunRecord:
    """The whole run's state: story, base commit, frozen configuration and
    one SliceRecord per slice, in domain-then-UI order.

    Parallel slice loops mutate and persist the shared record: every state
    transition and save runs under one reentrant lock, so a persisted
    snapshot always contains every settled transition and never a torn
    one."""

    story_number: int
    base_sha: str
    config: dict[str, dict[str, str]]
    slices: dict[str, SliceRecord] = field(default_factory=dict)
    terminal: str = ""  # empty while the run is live; the outcome name when stopped
    # Block 4's delivery state: integration branch and head, the PR number,
    # review rounds and their findings, and whether the one CI rerun is spent.
    delivery: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._lock = threading.RLock()

    @contextmanager
    def transition(self):
        """Serialize one slice's state change and its persistence."""
        with self._lock:
            yield

    def ordered(self) -> list[SliceRecord]:
        """Slices in domain-then-ui order, the reporting order."""
        return [self.slices[layer] for layer in ("domain", "ui") if layer in self.slices]

    # --- persistence ---------------------------------------------------------

    def save(self) -> None:
        path = state_path(self.story_number)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Parallel slice loops save concurrently: a per-write unique tmp name
        # keeps one loop's replace from unlinking another's tmp underneath it.
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True))
        tmp.replace(path)

    def to_dict(self) -> dict:
        return {
            "story_number": self.story_number,
            "base_sha": self.base_sha,
            "config": self.config,
            "terminal": self.terminal,
            "delivery": self.delivery,
            "slices": {layer: asdict(record) for layer, record in self.slices.items()},
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_dict(cls, payload: dict) -> "RunRecord":
        slices = {
            layer: SliceRecord(**record) for layer, record in payload.get("slices", {}).items()
        }
        return cls(
            story_number=payload["story_number"],
            base_sha=payload["base_sha"],
            config=payload["config"],
            slices=slices,
            terminal=payload.get("terminal", ""),
            delivery=payload.get("delivery", {}),
        )

    # --- turn identities ------------------------------------------------------

    def begin_turn(self, piece: SliceRecord, role: str, attempt: int, kind: str) -> dict:
        """Persist the turn identity before launching the agent turn.
        Another active turn on the same slice is a contract failure."""
        with self._lock:
            if any(entry["status"] == "running" for entry in piece.turns):
                raise FlowFailure(
                    Outcome.AGENT_BROKE_CONTRACT,
                    f"refusing to launch on {piece.slug}: a turn is still running",
                    piece.number,
                )
            identity = piece.turn_identity(role, piece.revision, attempt)
            entry = {
                **identity,
                "kind": kind,
                "status": "running",
                "result": "",
                "why": "",
                "session": "",
            }
            piece.turns.append(entry)
            self.save()
            return identity

    def end_turn(
        self, piece: SliceRecord, identity: dict, result: str, why: str, session: str = ""
    ) -> None:
        """Persist the turn's completion - including the agent's session id -
        before choosing the next transition. Completing the same identity
        twice with the same result is a no-op; a conflicting completion or a
        changed session id is a contract failure."""
        with self._lock:
            ident = piece.turn_identity(identity["role"], identity["revision"], identity["attempt"])
            running = [
                entry
                for entry in piece.turns
                if entry["status"] == "running" and _matches(entry, ident)
            ]
            if not running:
                raise FlowFailure(
                    Outcome.AGENT_BROKE_CONTRACT,
                    f"turn completion with no reserved identity on {piece.slug}: {ident}",
                    piece.number,
                )
            for entry in running:
                if entry["result"] and entry["result"] != result:
                    raise FlowFailure(
                        Outcome.AGENT_BROKE_CONTRACT,
                        f"conflicting completion for turn {ident} on {piece.slug}: "
                        f"{entry['result']} vs {result}",
                        piece.number,
                    )
                if entry["session"] and session and entry["session"] != session:
                    raise FlowFailure(
                        Outcome.AGENT_BROKE_CONTRACT,
                        f"turn {ident} on {piece.slug} completed from a different "
                        f"session: {entry['session']} vs {session}",
                        piece.number,
                    )
                entry["status"] = "completed"
                entry["result"] = result
                entry["why"] = why
                if session:
                    entry["session"] = session
            self.save()


def _matches(entry: dict, identity: dict) -> bool:
    return all(entry[key] == value for key, value in identity.items())


def _config_snapshot(roster: dict) -> dict[str, dict[str, str]]:
    return {
        role: {"backend": agent.backend, "model": agent.model, "effort": agent.effort}
        for role, agent in roster.items()
    }


def begin_run(story_number: int, base_sha: str, roster: dict, slices: list) -> RunRecord:
    """Create and persist the run's retained record from block 1's outputs.
    `slices` are fitflow.slice.Slice objects, in domain-then-ui order.

    A story that already carries a state file is an interrupted or finished
    earlier run whose workers may have launched uncertainly. There is no
    resume contract: stop and preserve instead of overwriting the record."""
    if state_path(story_number).exists():
        raise FlowFailure(
            Outcome.RUN_STATE_CONFLICT,
            f"an earlier run for story #{story_number} left state at "
            f"{state_path(story_number)}; audit it, then remove the file "
            "manually before rerunning",
            story_number,
            add_blocked=True,
        )
    record = RunRecord(
        story_number=story_number,
        base_sha=base_sha,
        config=_config_snapshot(roster),
        slices={
            piece.layer: SliceRecord(
                number=piece.number,
                layer=piece.layer,
                title=piece.title,
                slug=f"story-{piece.number}-{piece.layer}",
                branch=f"story-{piece.number}-{piece.layer}",
                team=f"story-{piece.number}-{piece.layer}",
                worktree=str(
                    settings.FIT_REPO
                    / ".claude"
                    / "worktrees"
                    / f"story-{piece.number}-{piece.layer}"
                ),
                brief=piece.brief,
                acceptance=list(piece.acceptance),
                test_kind=piece.test_kind,
                test_files=list(piece.test_files),
                failing_sha=piece.commit,
            )
            for piece in slices
        },
    )
    record.save()
    return record


def retained_inputs(story_number: int, layer: str, acceptance_count: int):
    """The immutable retained inputs a slice's evidence may cite. Every
    ref resolves inside this run, and `acceptance/<n>` only resolves for
    the indices that slice actually has - evidence cannot cite a criterion
    that does not exist. Anything else is a contract rejection."""
    from fitflow.assignment import RetainedInputs

    base = f"run-{story_number}/{layer}"
    refs = {
        f"{base}/{field}"
        for field in ("brief", "issue_context", "failing_tests", "branch", "worktree", "team")
    }
    refs.update({f"{base}/acceptance/{index}" for index in range(acceptance_count)})
    refs.add(f"run-{story_number}/ownership")
    return RetainedInputs(slice_ref=base, resolvable_refs=frozenset(refs))
