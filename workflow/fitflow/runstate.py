"""The run's exclusive story lock and its persisted lifecycle state.

A second `go.py` execution on the same story must fail without starting
workers: a held issue label alone is not an exclusive lock, so each run
holds a non-blocking flock on `locks/story-<n>.lock` for its whole life.

The state file `runs/story-<n>.json` is the run's retained record and its
slice state machines: block 1's slice identities (issue, branch, worktree,
team, failing-test commit, test files), the frozen startup configuration,
every assignment revision, attempt counters and turn identities. Every
transition persists before the next one is chosen. A fresh run refuses a
story that already has a record; `go.py <n> --resume` loads it, reconciles
every slice against the worktree it left behind (steps/resume.py) and
continues, and `go.py <n> --reset` archives it beside what it undoes.
"""

import datetime
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

# Block 3's level loop, exactly as narrated in implement._run_slice:
# assigned -> running -> validating -> (correcting -> running | escalating ->
# (assigned | failed) | succeeded | failed). Block 2's delegation re-confirms
# "assigned" on the freshly created record (a no-op transition), and block 4's
# review_fix_turn is the one sanctioned exit from "succeeded", into "fixing"
# and back through "validating". Every unlisted transition is prohibited.
_TRANSITIONS: dict[str, frozenset[str]] = {
    "assigned": frozenset({"assigned", "running"}),
    "running": frozenset({"validating", "failed"}),
    "validating": frozenset({"correcting", "escalating", "succeeded", "failed"}),
    "correcting": frozenset({"running"}),
    "escalating": frozenset({"assigned", "failed"}),
    "succeeded": frozenset({"fixing"}),
    "fixing": frozenset({"validating"}),
    "failed": frozenset(),
}

# The resume-only jumps, sanctioned nowhere else: steps/resume.py puts a
# slice back where its last turn actually left it. A turn the driver never
# saw end is voided, so the slice returns to the launch it was about to
# make (assigned before attempt 1, correcting after); a turn that ended
# with a valid reply is "running" again with its verdict pending, and
# block 3 re-derives that verdict without another agent call. `failed`
# reopens the same way: it records the driver's own judgement, which a
# fixed driver is allowed to re-derive.
_RESUME_TRANSITIONS: dict[str, frozenset[str]] = {
    "assigned": frozenset({"assigned"}),
    "running": frozenset({"assigned", "correcting", "running"}),
    "validating": frozenset({"running"}),
    "correcting": frozenset({"correcting"}),
    "failed": frozenset({"assigned", "correcting", "running"}),
}


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
    # Block 1's failing-test commit, which never moves. `failing_sha` is the
    # base the driver's later checks compare against, and it does move: when
    # a UI slice depends on its domain sibling, block 3 merges the frozen
    # domain commit into the UI branch and `failing_sha` becomes that merge.
    tests_sha: str = ""
    # "domain" on a UI slice the planner judged cannot be implemented and
    # validated before its domain sibling exists; "" for an independent one.
    depends_on: str = ""
    # the sibling's frozen commit this slice's branch already carries
    sibling_merged: str = ""
    role: str = ""
    revision: int = 0
    attempts: int = 0
    state: str = "assigned"
    diagnostics: list[str] = field(default_factory=list)
    assignments: list[dict] = field(default_factory=list)
    turns: list[dict] = field(default_factory=list)
    frozen_commit: str = ""
    implementation_sha: str = ""

    @property
    def acceptance_sha(self) -> str:
        """The commit whose acceptance-test bytes are immutable: the tests
        exactly as block 1 wrote them. `failing_sha` moves when the driver
        merges a domain sibling into a dependent UI branch; this does not.
        A record written before the field existed falls back to it."""
        return self.tests_sha or self.failing_sha

    def turn_identity(self, role: str, revision: int, attempt: int) -> dict:
        return {"layer": self.layer, "role": role, "revision": revision, "attempt": attempt}

    def move(self, state: str) -> None:
        """The only sanctioned way to change `state`. Callers must already
        hold the run's `transition()` lock; an unlisted jump is a driver bug,
        not a repairable condition."""
        allowed = _TRANSITIONS.get(self.state, frozenset())
        if state not in allowed:
            raise RuntimeError(f"prohibited slice transition {self.state} → {state}")
        self.state = state

    def resume_to(self, state: str) -> None:
        """The resume-only counterpart of `move`, for steps/resume.py: a
        slice goes back to the point its last turn actually reached."""
        allowed = _RESUME_TRANSITIONS.get(self.state, frozenset())
        if state not in allowed:
            raise RuntimeError(f"prohibited resume transition {self.state} → {state}")
        self.state = state


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
                # the reply the turn ended with, and the working tree's
                # digest at that moment: what a resume re-validates, and
                # how it knows nobody touched the tree in between
                "reply": None,
                "digest": "",
            }
            piece.turns.append(entry)
            self.save()
            return identity

    def end_turn(
        self,
        piece: SliceRecord,
        identity: dict,
        result: str,
        why: str,
        session: str = "",
        reply: dict | None = None,
        digest: str = "",
    ) -> None:
        """Persist the turn's completion - including the agent's session id,
        its reply and the working tree's digest - before choosing the next
        transition. Completing the same identity twice with the same result
        is a no-op; a conflicting completion or a changed session id is a
        contract failure."""
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
                self._check_completion(piece, entry, ident, result, session)
                _complete(entry, result, why, session, reply, digest)
            self.save()

    def _check_completion(
        self, piece: SliceRecord, entry: dict, ident: dict, result: str, session: str
    ) -> None:
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


def _complete(
    entry: dict, result: str, why: str, session: str, reply: dict | None, digest: str
) -> None:
    entry["status"] = "completed"
    entry["result"] = result
    entry["why"] = why
    if session:
        entry["session"] = session
    if reply is not None:
        entry["reply"] = reply
    if digest:
        entry["digest"] = digest


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
    earlier run whose workers may have launched uncertainly. A fresh run
    never overwrites it: `--resume` continues it, `--reset` archives it."""
    if state_path(story_number).exists():
        raise FlowFailure(
            Outcome.RUN_STATE_CONFLICT,
            f"an earlier run for story #{story_number} left state at "
            f"{state_path(story_number)}; continue it with "
            f"`go.py {story_number} --resume`, or archive it and undo what it "
            f"created with `go.py {story_number} --reset`",
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
                tests_sha=piece.commit,
            )
            for piece in slices
        },
    )
    record.save()
    return record


def load_run(story_number: int) -> RunRecord:
    """The retained record of an earlier run, or a stop when there is none:
    a story with nothing retained has nothing to resume."""
    path = state_path(story_number)
    if not path.exists():
        raise FlowFailure(
            Outcome.CANNOT_PICK,
            f"#{story_number} has no retained run at {path}; nothing to resume",
        )
    try:
        return RunRecord.from_dict(json.loads(path.read_text()))
    except (ValueError, KeyError, TypeError) as error:
        raise FlowFailure(
            Outcome.RUN_STATE_CONFLICT,
            f"the retained run at {path} cannot be read ({error}); audit it, then "
            f"`go.py {story_number} --reset`",
            story_number,
        ) from error


def has_run(story_number: int) -> bool:
    return state_path(story_number).exists()


def archive_run(story_number: int) -> Path | None:
    """Move the record aside for audit - `runs/story-<n>.<stamp>.reset.json`
    - so a fresh run can begin. None when there was no record."""
    path = state_path(story_number)
    if not path.exists():
        return None
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = path.with_name(f"{path.stem}.{stamp}.reset.json")
    path.replace(target)
    return target


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
