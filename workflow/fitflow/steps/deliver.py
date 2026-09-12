"""Box: deliver - integration branch, PR, review, CI, merge.

The block 3 join is re-verified first; nothing is pushed until every slice
is still exactly its frozen commit. One integration branch `story-<n>`
merges the frozen commits (never cherry-picks: the approved SHAs must
survive), one PR ends `Closes #N`. A deterministic predicate recomputed
from the retained signals decides whether the reviewer runs; its verdict
is validated against the actual diff, and a `fix` verdict is the one
sanctioned exit from a succeeded slice. Claims come from `gh pr checks`
parsed by the driver, with exactly one counted rerun; the merge is a fixed
command shape behind the pre-merge barrier.
"""

import time
from pathlib import Path

from fitflow import (
    agents,
    github,
    narrate,
    review,
    settings,
    worktrees,
)
from fitflow.outcome import FlowFailure, Outcome
from fitflow.review import Finding
from fitflow.runstate import RunRecord
from fitflow.steps.implement import review_fix_turn, verify_frozen

_MAX_REVIEWER_ATTEMPTS = 3


def run(story, record: RunRecord) -> Outcome:
    """Block 4 for the joined run: deliver and merge. DELIVERED is persisted
    only after the final GitHub comment succeeds. The terminal string is the
    literal, not Outcome.DELIVERED.name: PLANNED is that value's first alias
    and the audit record must say what actually happened."""
    _deliver(story, record)
    _report_gate(story, record)
    _persist_terminal(record, "DELIVERED")
    return Outcome.DELIVERED


def _deliver(story, record: RunRecord) -> None:
    try:
        verify_frozen(record)
        narrate.line("🚦 Pre-delivery barrier: every slice still at its frozen commit")
        path = _integrate(story, record)
        _open_pr(story, record, path)
        if review.is_mechanical(record):
            record.delivery["verdict"] = "mechanical"
            record.save()
            narrate.line("🪙 Mechanical change: every slice's signals still select row 4")
        else:
            _review_loop(story, record, path)
        _claims(story, record)
        _merge(story, record)
    except FlowFailure as failure:
        raise FlowFailure(failure.outcome, failure.why, record.story_number, True) from failure
    except Exception as error:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"delivery failed unexpectedly: {_describe(error)}",
            record.story_number,
            True,
        ) from error


def _report_gate(story, record: RunRecord) -> None:
    try:
        _report(story, record)
    except FlowFailure as failure:
        _persist_terminal(record, failure.outcome.name)
        raise FlowFailure(failure.outcome, failure.why, record.story_number, True) from failure
    except Exception as error:
        _persist_terminal(record, Outcome.TOOL_FAILED.name)
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"delivery merged but the run failed while reporting: {_describe(error)}",
            record.story_number,
            True,
        ) from error


def _persist_terminal(record: RunRecord, terminal: str) -> None:
    with record.transition():
        record.terminal = terminal
        record.save()


def _describe(error: Exception) -> str:
    if isinstance(error, FlowFailure):
        return f"{error.outcome.name} — {error.why}"
    return f"{type(error).__name__} — {error}"


# --- integration --------------------------------------------------------------


def _integrate(story, record: RunRecord) -> Path:
    slug = f"story-{story.number}"
    path = worktrees.integration_worktree_path(slug)
    if path.exists() or worktrees.branch_exists(slug):
        raise FlowFailure(
            Outcome.WORKTREE_EXISTS,
            f"integration worktree/branch '{slug}' already exists; audit it, then "
            "remove it manually before rerunning",
            story.number,
        )
    path = worktrees.create_integration_worktree(slug)
    narrate.line(f"🌿 Integration worktree {slug} · branch {slug}")
    for piece in record.ordered():
        try:
            worktrees.merge_commit(path, piece.frozen_commit)
        except Exception as error:
            worktrees.abort_merge(path)
            raise FlowFailure(
                Outcome.PLAN_REJECTED,
                f"merging {piece.slug} into {slug} conflicts: independent green slices "
                "could not be combined; a revised plan in a new run is required "
                f"({error})",
                story.number,
                add_blocked=True,
            ) from error
        if not worktrees.is_ancestor(path, piece.frozen_commit):
            raise FlowFailure(
                Outcome.TOOL_FAILED,
                f"{piece.slug}'s frozen commit is not an ancestor of {slug} after merging",
                story.number,
                add_blocked=True,
            )
        narrate.line(f"   │ merged {piece.slug} at {piece.frozen_commit[:12]}")
    head = worktrees.local_head(path)
    worktrees.push_branch(path, slug)
    with record.transition():
        record.delivery.update(
            integration_branch=slug, integration_sha=head, worktree=str(path)
        )
        record.save()
    narrate.line(f"⇪ Pushed {slug} at {head[:12]}")
    return path


def _open_pr(story, record: RunRecord, path: Path) -> int:
    number = record.delivery.get("pr_number")
    if number:
        return int(number)
    parts = ", ".join(
        f"{piece.layer} at {piece.frozen_commit[:12]}" for piece in record.ordered()
    )
    body = (
        f"Implements #{story.number}.\n\n"
        f"Slices: {parts}.\n"
        "Every slice passed the driver's independent validation and the "
        "repository's diff-sized pre-push gate; the join re-verified the "
        "frozen commits before this branch was built.\n\nCloses "
        f"#{story.number}"
    )
    number = github.create_pr(story.title, body, record.delivery["integration_branch"])
    with record.transition():
        record.delivery["pr_number"] = number
        record.save()
    narrate.line(f"📥 Opened PR #{number} for #{story.number}")
    return number


# --- review -------------------------------------------------------------------


def _review_loop(story, record: RunRecord, path: Path) -> None:
    team = f"story-{story.number}-review"
    agents.ensure_fresh_team(team, path, story.number)
    rounds = 0
    while rounds < review.max_rounds():
        rounds += 1
        narrate.line(f"🕵️ Review round {rounds}/{review.max_rounds()}")
        verdict, findings = _reviewer_turn(story, record, team, path, rounds)
        with record.transition():
            record.delivery["rounds"] = rounds
            record.delivery["verdict"] = verdict
            record.delivery["findings"] = [
                {
                    "file": finding.file,
                    "line": finding.line,
                    "category": finding.category,
                    "required_fix": finding.required_fix,
                }
                for finding in findings
            ]
            record.save()
        if verdict == "merge":
            narrate.line(f"✅ Reviewer approved after {rounds} round(s)")
            return
        _apply_fixes(story, record, path, findings)
    _stop_for_gabriel(
        story,
        f"the reviewer still rejected delivery after {review.max_rounds()} review rounds",
    )
    raise FlowFailure(
        Outcome.CAPACITY_EXHAUSTED,
        f"review did not converge within {review.max_rounds()} rounds",
        story.number,
        add_blocked=True,
    )


def _reviewer_turn(
    story, record: RunRecord, team: str, path: Path, rounds: int
) -> tuple[str, list[Finding]]:
    """One bounded reviewer loop: one initial review turn plus at most two
    corrective retries in the same reviewer session. Only a malformed reply
    the reviewer can author and resubmit is retryable; a contract breach or
    a drifted session stops the run."""
    diagnostic = ""
    reviewer_session = ""
    for attempt in range(1, _MAX_REVIEWER_ATTEMPTS + 1):
        prompt_name = "review" if attempt == 1 else "review_correct"
        reply, session = agents.talk(
            team,
            "reviewer",
            prompt_name,
            "review",
            attribute_failures_to=story.number,
            story_number=story.number,
            pr_number=record.delivery["pr_number"],
            branch=record.delivery["integration_branch"],
            acceptance=_acceptance_lines(record),
            fix_note=_fix_note(record, rounds),
            diagnostic=diagnostic,
        )
        reviewer_session = _require_reviewer_session(
            story.number, reviewer_session, session, attempt
        )
        try:
            verdict, findings = review.validate_reply(
                reply,
                worktrees.diff_files_against_main(
                    path, record.delivery["integration_branch"]
                ),
            )
        except review.ReviewError as rejection:
            if attempt == _MAX_REVIEWER_ATTEMPTS:
                narrate.line(
                    f"🛑 Reviewer exhausted {_MAX_REVIEWER_ATTEMPTS} attempts — {rejection}"
                )
                raise FlowFailure(
                    Outcome.TOOL_FAILED,
                    f"reviewer reply never satisfied the contract: {rejection}",
                    story.number,
                    add_blocked=True,
                ) from rejection
            diagnostic = str(rejection)
            narrate.line(f"🔁 Reviewer sending its diagnostic back after attempt {attempt}")
            continue
        except review.ReviewContractError as breach:
            raise FlowFailure(
                Outcome.AGENT_BROKE_CONTRACT,
                str(breach),
                story.number,
                add_blocked=True,
            ) from breach
        _verify_read_only(story, record, path)
        return verdict, findings
    raise AssertionError("unreachable: the loop returns or raises on every attempt")


def _require_reviewer_session(story_number: int, held: str, session: str, attempt: int) -> str:
    if attempt == 1:
        return session
    if session != held:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"reviewer left its session mid-loop: attempts 1..{attempt - 1} ran in "
            f"{held!r} but corrective attempt {attempt} ran in {session!r}",
            story_number,
            add_blocked=True,
        )
    return held


def _verify_read_only(story, record: RunRecord, path: Path) -> None:
    """The reviewer is read-only by verification, not by trust."""
    if not worktrees.is_clean(path):
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            "the reviewer wrote to the integration worktree; it is read-only",
            story.number,
            add_blocked=True,
        )
    if worktrees.local_head(path) != record.delivery["integration_sha"]:
        raise FlowFailure(
            Outcome.AGENT_BROKE_CONTRACT,
            "the integration head moved during review",
            story.number,
            add_blocked=True,
        )


def _fix_note(record: RunRecord, rounds: int) -> str:
    if rounds == 1:
        return ""
    return (
        "Fixes were applied since the last review for these findings:\n"
        + "\n".join(
            f"- {item['file']}:{item['line']} [{item['category']}]"
            for item in record.delivery.get("findings", [])
        )
    )


def _acceptance_lines(record: RunRecord) -> str:
    lines = []
    for piece in record.ordered():
        lines.append(f"{piece.layer} (#{piece.number}):")
        lines.extend(f"  - {item}" for item in piece.acceptance)
    return "\n".join(lines)


def _apply_fixes(story, record: RunRecord, path: Path, findings: list[Finding]) -> None:
    affected = review.route_findings(record, findings)
    narrate.line(f"🛠 Review findings routed to slices: {', '.join(affected)}")
    for layer in affected:
        piece = record.slices[layer]
        slice_findings = [
            finding for finding in findings if review.owns(piece.layer, finding.file)
        ]
        review_fix_turn(record, piece, review.findings_diagnostic(slice_findings))
        worktrees.merge_commit(path, piece.frozen_commit)
        if not worktrees.is_ancestor(path, piece.frozen_commit):
            raise FlowFailure(
                Outcome.TOOL_FAILED,
                f"{piece.slug}'s new frozen commit is not an ancestor of the integration branch",
                story.number,
                add_blocked=True,
            )
    head = worktrees.local_head(path)
    worktrees.push_branch(path, record.delivery["integration_branch"])
    with record.transition():
        record.delivery["integration_sha"] = head
        record.save()
    narrate.line(f"⇪ Pushed fixes; integration head {head[:12]}")


def _stop_for_gabriel(story, why: str) -> None:
    github.add_label(story.number, settings.NEEDS_GABRIEL_LABEL)
    github.assign(story.number, settings.GABRIEL_LOGIN)
    narrate.line(f"✏️  #{story.number} labelled {settings.NEEDS_GABRIEL_LABEL}")


# --- claims, CI, merge ----------------------------------------------------------


def _claims(story, record: RunRecord) -> None:
    """The driver's own read of the PR's checks: the required check green,
    one counted rerun, pending past the timeout is a tool failure. Checks
    that have not registered yet - the normal state seconds after a PR
    opens - are pending like any other, and so is the required check before
    its needs finish."""
    pr_number = int(record.delivery["pr_number"])
    branch = record.delivery["integration_branch"]
    deadline = time.monotonic() + settings.CI_TIMEOUT
    while True:
        checks = github.pr_checks(pr_number)
        failed = [check.name for check in checks if check.state in _FAILED_STATES]
        waiting = [
            check.name
            for check in checks
            if check.state not in _FAILED_STATES and check.state not in _GREEN_STATES
        ]
        if not checks or settings.REQUIRED_CHECK not in {check.name for check in checks}:
            waiting = [*waiting, "(the required check has not registered yet)"]
        if failed:
            if waiting:
                # a failed job while others still run: the workflow run is
                # not completed, and `gh run rerun --failed` refuses an
                # in-progress run - wait for the run to settle first
                _await_checks(story, pr_number, deadline, waiting)
                continue
            _react_to_red(story, record, branch, pr_number, failed)
            continue
        if waiting:
            _await_checks(story, pr_number, deadline, waiting)
            continue
        _require_all_green(story, pr_number, checks)
        narrate.line(f"🟢 CI green on PR #{pr_number} ({len(checks)} checks)")
        return


# `gh pr checks --json state` vocabulary, classified. A cancelled or timed
# out run is not green; NEUTRAL (e.g. a skipped-not-applicable job) is.
_FAILED_STATES = {"FAILURE", "CANCELLED", "TIMED_OUT"}
_GREEN_STATES = {"SUCCESS", "SKIPPED", "NEUTRAL"}


def _react_to_red(
    story, record: RunRecord, branch: str, pr_number: int, failed: list[str]
) -> None:
    if record.delivery.get("rerun_used"):
        raise FlowFailure(
            Outcome.CAPACITY_EXHAUSTED,
            f"CI is red on PR #{pr_number} after the one allowed rerun: {', '.join(failed)}",
            story.number,
            add_blocked=True,
        )
    _rerun(story, record, branch, failed)


def _await_checks(story, pr_number: int, deadline: float, pending: list[str]) -> None:
    if time.monotonic() > deadline:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"CI checks on PR #{pr_number} stayed pending past "
            f"{settings.CI_TIMEOUT}s: {', '.join(pending)}",
            story.number,
            add_blocked=True,
        )
    time.sleep(settings.CI_POLL_SECONDS)


def _require_all_green(story, pr_number: int, checks: list) -> None:
    names = {check.name: check.state for check in checks}
    required = names.get(settings.REQUIRED_CHECK)
    if required != "SUCCESS":
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"PR #{pr_number}'s {settings.REQUIRED_CHECK} check is {required!r}, not green",
            story.number,
            add_blocked=True,
        )


def _rerun(story, record: RunRecord, branch: str, failed: list[str]) -> None:
    run_id = github.failed_run(branch)
    if run_id is None:
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"CI is red on {branch} but no check run was found to rerun",
            story.number,
            add_blocked=True,
        )
    github.rerun_failed_runs(run_id)
    with record.transition():
        record.delivery["rerun_used"] = True
        record.save()
    narrate.line(f"🔁 Reran failed checks for {branch} (run {run_id}): {', '.join(failed)}")


def _merge(story, record: RunRecord) -> None:
    pr_number = int(record.delivery["pr_number"])
    pull = github.view_pr(pr_number)
    if pull.state != "OPEN":
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"PR #{pr_number} is {pull.state}, not OPEN, before the merge",
            story.number,
            add_blocked=True,
        )
    github.merge_pr(pr_number)
    deadline = time.monotonic() + settings.CI_TIMEOUT
    while github.view_pr(pr_number).state != "MERGED":
        if time.monotonic() > deadline:
            raise FlowFailure(
                Outcome.TOOL_FAILED,
                f"PR #{pr_number} did not reach MERGED within {settings.CI_TIMEOUT}s",
                story.number,
                add_blocked=True,
            )
        time.sleep(settings.CI_POLL_SECONDS)
    narrate.line(f"🤝 Merged PR #{pr_number}")


def _report(story, record: RunRecord) -> None:
    parts = ", ".join(
        f"#{piece.number} {piece.layer} ({piece.frozen_commit[:12]})" for piece in record.ordered()
    )
    body = (
        f"Delivered: PR #{record.delivery['pr_number']} merged "
        f"({record.delivery['integration_sha'][:12]}). Slices: {parts}. "
        "Next: block 5, after merge."
    )
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    narrate.line(f"🏁 Delivered #{story.number} → PR #{record.delivery['pr_number']}")
