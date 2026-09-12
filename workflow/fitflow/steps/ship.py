"""Box: after merge - tag, main CI, QA, flaky, prod, android, cleanup.

Everything here runs after a merge that already landed, so nothing is a
retry of blocks 1-4 and nothing is ever a rollback: a failure is recorded,
reported and the run stops. The commit being shipped is the PR's merge
commit, because main squashes and no branch the driver pushed points at
what landed. Every sub-step is verified by the driver rather than believed
from an exit code - the tag is read off origin, main's CI is judged by
`main-ci-gate.ts`'s own acceptance, and each deploy is judged by reading
the smoke report it left behind. Each result is persisted under
`delivery.ship` as it settles, so the record says exactly how far the ship
got.
"""

import json
import time
from pathlib import Path

from fitflow import github, narrate, settings, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord

# The smoke check whose detail names the release that actually went live.
# `smoke.ts` writes no commit field of its own; this is where it says so.
_RELEASE_CHECK = "the live release is this commit"

# The job-name prefix `ci.yml` gives its browser matrix.
_E2E_PREFIX = "End-to-end"

_QUEUE_BRANCH_PREFIX = "gh-readonly-queue/main/"


def run(story, record: RunRecord) -> Outcome:
    """Block 5 for the merged run. SHIPPED is persisted only after the
    final GitHub comment succeeds, and the terminal string is the literal:
    PLANNED is that value's first alias and the audit record must say what
    actually happened."""
    try:
        deferred = _ship(story, record)
    except FlowFailure as failure:
        _persist_terminal(record, failure.outcome.name)
        raise FlowFailure(failure.outcome, failure.why, record.story_number) from failure
    except Exception as error:
        _persist_terminal(record, Outcome.TOOL_FAILED.name)
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"the merge landed but shipping failed unexpectedly: {_describe(error)}",
            record.story_number,
        ) from error
    _report_gate(story, record)
    if deferred:
        _persist_terminal(record, Outcome.TOOL_FAILED.name)
        raise FlowFailure(Outcome.TOOL_FAILED, "; ".join(deferred), record.story_number)
    _persist_terminal(record, "SHIPPED")
    return Outcome.SHIPPED


def _ship(story, record: RunRecord) -> list[str]:
    """Returns the failures that must be reported before they stop the run:
    a deploy that already succeeded is not undone by a broken Android
    toolchain or a worktree that would not go away."""
    config = settings.ship_config()
    narrate.line(f"🚢 Shipping #{record.story_number} to {'prod' if config.to_prod else 'QA only'}")
    merge_sha = _merge_sha(record)
    _await_tag(record, merge_sha)
    _await_main_ci(record, merge_sha)
    path = _release_worktree(record, merge_sha)
    _deploy(story, record, path, "qa", config.qa, merge_sha, tunnel=True)
    flaky = _flaky(record, merge_sha)
    if config.to_prod and not flaky["flaky"]:
        _deploy(story, record, path, "prod", config.prod, merge_sha, tunnel=False)
    deferred = _android(record, path, config)
    return deferred + _cleanup(record, merge_sha)


# --- the record ---------------------------------------------------------------


def _remember(record: RunRecord, key: str, value) -> None:
    with record.transition():
        record.delivery.setdefault("ship", {})[key] = value
        record.save()


def _ship_value(record: RunRecord, key: str, default=None):
    return record.delivery.get("ship", {}).get(key, default)


def _persist_terminal(record: RunRecord, terminal: str) -> None:
    with record.transition():
        record.terminal = terminal
        record.save()


def _describe(error: Exception) -> str:
    if isinstance(error, FlowFailure):
        return f"{error.outcome.name} — {error.why}"
    return f"{type(error).__name__} — {error}"


def _stop(record: RunRecord, outcome: Outcome, why: str) -> FlowFailure:
    return FlowFailure(outcome, why, record.story_number)


# --- the merge commit and its tag ---------------------------------------------


def _merge_sha(record: RunRecord) -> str:
    pr_number = int(record.delivery["pr_number"])
    sha = github.merge_commit(pr_number)
    if not sha:
        raise _stop(
            record,
            Outcome.TOOL_FAILED,
            f"PR #{pr_number} is merged but GitHub reports no merge commit for it",
        )
    _remember(record, "merge_sha", sha)
    narrate.line(f"📌 PR #{pr_number} landed as {sha[:12]}")
    return sha


def _await_tag(record: RunRecord, merge_sha: str) -> str:
    """`version-tag.yml` tags every merge to main; the driver never tags."""
    deadline = time.monotonic() + settings.MAIN_CI_TIMEOUT
    while True:
        tags = worktrees.tags_at(merge_sha)
        if tags:
            _remember(record, "tag", tags[0])
            narrate.line(f"🏷️  {merge_sha[:12]} is tagged {tags[0]}")
            return tags[0]
        if time.monotonic() > deadline:
            raise _stop(
                record,
                Outcome.TOOL_FAILED,
                f"no v* tag points at {merge_sha[:12]} after "
                f"{settings.MAIN_CI_TIMEOUT}s; version-tag.yml should have "
                "tagged this merge, so read that workflow's run before shipping",
            )
        narrate.line(f"⏳ Waiting for version-tag.yml to tag {merge_sha[:12]}")
        time.sleep(settings.CI_POLL_SECONDS)


# --- main's own CI ------------------------------------------------------------


def _qualifying(runs: list) -> tuple[object | None, object | None]:
    """The two runs `main-ci-gate.ts` accepts, newest first per event: the
    push run on main, and the merge queue's run of the same commit. A
    `--commit` match can also be a run of that commit on some other branch,
    so the branch is checked per event rather than dropped."""
    push = next((run for run in runs if run.event == "push" and run.head_branch == "main"), None)
    queue = next(
        (
            run
            for run in runs
            if run.event == "merge_group" and run.head_branch.startswith(_QUEUE_BRANCH_PREFIX)
        ),
        None,
    )
    return push, queue


def _green(run) -> bool:
    return run is not None and run.status == "completed" and run.conclusion == "success"


def _pending(run) -> bool:
    return run is not None and run.status != "completed"


def _await_main_ci(record: RunRecord, merge_sha: str) -> None:
    """The same acceptance `scripts/deploy/main-ci-gate.ts` applies, applied
    here so the driver knows why it may ship rather than letting the deploy
    find out."""
    deadline = time.monotonic() + settings.MAIN_CI_TIMEOUT
    while True:
        push, queue = _qualifying(github.ci_runs_for(merge_sha))
        accepted = push if _green(push) else queue if _green(queue) else None
        if accepted is not None:
            _remember(record, "main_ci", {"event": accepted.event, "url": accepted.url})
            narrate.line(
                f"🟢 main's CI accepts {merge_sha[:12]}: its {accepted.event} run "
                f"is green ({accepted.url})"
            )
            return
        _refuse_or_wait(record, merge_sha, push, queue, time.monotonic() > deadline)
        narrate.line(f"⏳ Waiting for main's CI on {merge_sha[:12]}")
        time.sleep(settings.CI_POLL_SECONDS)


def _refuse_or_wait(record: RunRecord, merge_sha: str, push, queue, expired: bool) -> None:
    """Returns only when the runs are worth waiting on. No run at all is
    refused outright rather than waited on: a ship that finds nothing has
    arrived before CI was even triggered, and waiting on a run that may
    never exist is the failure this gate is here to prevent."""
    if push is None and queue is None:
        raise _stop(
            record,
            Outcome.TOOL_FAILED,
            f"no ci.yml run on main for {merge_sha[:12]}; refusing to ship it",
        )
    if not _pending(push) and not _pending(queue):
        raise _stop(
            record,
            Outcome.TOOL_FAILED,
            f"main's CI for {merge_sha[:12]} concluded without success "
            f"({_describe_runs(push, queue)}); a red main after a merge is a "
            "human call, not this run's to fix",
        )
    if expired:
        raise _stop(
            record,
            Outcome.TOOL_FAILED,
            f"main's CI for {merge_sha[:12]} is still running after "
            f"{settings.MAIN_CI_TIMEOUT}s ({_describe_runs(push, queue)})",
        )


def _describe_runs(push, queue) -> str:
    parts = [
        f"{run.event} run concluded {run.conclusion!r}: {run.url}"
        for run in (push, queue)
        if run is not None
    ]
    return "; ".join(parts)


# --- the release checkout ------------------------------------------------------


def _release_worktree(record: RunRecord, merge_sha: str) -> Path:
    """One installed checkout at exactly the commit being shipped, which is
    what `deploy.ts` names the release after and what the smoke check then
    asserts is live."""
    slug = f"release-story-{record.story_number}"
    if worktrees.slice_worktree_exists(slug):
        raise _stop(
            record,
            Outcome.WORKTREE_EXISTS,
            f"release worktree/branch '{slug}' already exists; audit it, then "
            "remove it manually before rerunning",
        )
    path = worktrees.create_release_worktree(slug, merge_sha)
    head = worktrees.local_head(path)
    if head != merge_sha or not worktrees.is_clean(path):
        raise _stop(
            record,
            Outcome.TOOL_FAILED,
            f"the release worktree {slug} is at {head[:12]} "
            f"({worktrees.status_summary(path)}), not a clean {merge_sha[:12]}",
        )
    _remember(record, "release_worktree", {"slug": slug, "path": str(path), "head": head})
    narrate.line(f"🌿 Release worktree {slug} at {merge_sha[:12]} · clean ✔")
    return path


# --- the deploys ---------------------------------------------------------------


def _smoke_verdict(path: Path, merge_sha: str) -> tuple[bool, str]:
    """`deploy.ts`'s exit code is not the verdict; the report it left is.
    `smoke.json` carries no commit of its own - the release it asserted is
    in one check's detail - so that is what is compared."""
    report_path = path / "reports" / "deploy" / "smoke.json"
    if not report_path.exists():
        return False, "the deploy wrote no reports/deploy/smoke.json, so nothing was verified"
    try:
        report = json.loads(report_path.read_text())
    except ValueError as error:
        return False, f"reports/deploy/smoke.json is unparsable: {error}"
    if not report.get("ok"):
        return False, report.get("failure") or "the smoke check did not pass"
    detail = next(
        (
            check.get("detail", "")
            for check in report.get("passed", [])
            if check.get("name") == _RELEASE_CHECK
        ),
        "",
    )
    if merge_sha not in detail:
        return False, (
            f"the smoke check passed against another release ({detail or 'no release check'}), "
            f"not {merge_sha[:12]}"
        )
    return True, ""


def _deploy(story, record, path: Path, name: str, target, merge_sha: str, tunnel: bool) -> None:
    narrate.line(f"🚀 Deploying {merge_sha[:12]} to {name} ({target.origin})")
    code = worktrees.run_deploy(
        path, target.host, target.origin, tunnel, lambda line: narrate.block([line])
    )
    ok, why = _smoke_verdict(path, merge_sha)
    if code != 0 and ok:
        ok, why = False, f"bun run deploy exited {code}"
    _remember(
        record,
        name,
        {"ok": ok, "host": target.host, "origin": target.origin, "tunnel": tunnel, "why": why},
    )
    if ok:
        narrate.line(f"✅ {name} is live at {merge_sha[:12]} · smoke ok")
        return
    narrate.line(f"❌ {name} deploy failed: {why}")
    _hand_to_gabriel(story)
    raise _stop(
        record,
        Outcome.DEPLOY_FAILED,
        f"the {name} deploy of {merge_sha[:12]} to {target.host} failed: {why}. "
        f"{_live_note(record)} Nothing was rolled back.",
    )


def _live_note(record: RunRecord) -> str:
    qa = _ship_value(record, "qa") or {}
    if qa.get("ok"):
        return f"QA remains live at {qa['origin']}."
    return "Nothing was deployed."


def _hand_to_gabriel(story) -> None:
    github.add_label(story.number, settings.NEEDS_GABRIEL_LABEL)
    github.assign(story.number, settings.GABRIEL_LOGIN)
    narrate.line(f"✏️  #{story.number} labelled {settings.NEEDS_GABRIEL_LABEL}")


# --- the flaky decision ---------------------------------------------------------


def _flaky(record: RunRecord, merge_sha: str) -> dict:
    """Whether a retried shard is why this commit looks green, in which
    case production waits for a human. Conservative by construction: an
    unfinished push run counts as flaky rather than as evidence of green."""
    reran = [
        name for name in record.delivery.get("rerun_failed", []) if name.startswith(_E2E_PREFIX)
    ]
    if reran:
        decision = {
            "flaky": True,
            "why": f"block 4's one counted rerun reran {', '.join(reran)}",
        }
    else:
        decision = _push_run_verdict(record, merge_sha)
    _remember(record, "flaky", decision)
    narrate.line(("🎲 Flaky: " if decision["flaky"] else "🎯 Not flaky: ") + decision["why"])
    return decision


def _push_run_verdict(record: RunRecord, merge_sha: str) -> dict:
    """`failOnFlakyTests` means a shard that only passed on its retry fails
    main's push run, which the merge queue's run of the same commit never
    hit - so a red push run beside a green queue run is the signature."""
    deadline = time.monotonic() + settings.MAIN_CI_TIMEOUT
    while True:
        push, queue = _qualifying(github.ci_runs_for(merge_sha))
        if _green(push):
            return {"flaky": False, "why": f"main's push run for {merge_sha[:12]} is green"}
        if push is None:
            return {
                "flaky": True,
                "why": f"main has no push run for {merge_sha[:12]}, so nothing re-executed "
                "this commit under the flake policy",
            }
        if not _pending(push):
            return {
                "flaky": True,
                "why": f"main's push run concluded {push.conclusion!r} ({push.url}) while the "
                f"merge_group run {queue.url if queue else '(none)'} succeeded",
            }
        if time.monotonic() > deadline:
            return {
                "flaky": True,
                "why": f"main's push run for {merge_sha[:12]} had not finished after "
                f"{settings.MAIN_CI_TIMEOUT}s ({push.url})",
            }
        narrate.line(f"⏳ Waiting for main's push run on {merge_sha[:12]} to settle")
        time.sleep(settings.CI_POLL_SECONDS)


# --- android --------------------------------------------------------------------


def _android(record: RunRecord, path: Path, config) -> list[str]:
    """The APK, and only after production actually took the release. A
    failure here says nothing about the deploy that already succeeded."""
    prod = _ship_value(record, "prod") or {}
    if not prod.get("ok") or not config.android:
        why = "FIT_FLOW_ANDROID=no" if prod.get("ok") else "production was not deployed"
        _remember(record, "android", {"ok": False, "skipped": True, "why": why})
        return []
    narrate.line(f"📱 Building the release APK against {config.prod.origin}")
    code, lines = worktrees.run_android_release(
        path, config.prod.origin, lambda line: narrate.block([line])
    )
    if code != 0:
        why = next((line for line in reversed(lines) if line.strip()), f"exited {code}")
        _remember(record, "android", {"ok": False, "skipped": False, "why": why})
        narrate.line(f"❌ The Android release failed: {why}")
        return [f"the Android release failed after a deploy that stands: {why}"]
    result = {
        "ok": True,
        "apk": _printed(lines, "APK: "),
        "sha256": _printed(lines, "SHA-256: "),
    }
    _remember(record, "android", result)
    narrate.line(f"📱 APK {result['apk']} · sha256 {result['sha256'][:12]}")
    return []


def _printed(lines: list[str], prefix: str) -> str:
    return next((line[len(prefix) :].strip() for line in lines if line.startswith(prefix)), "")


# --- cleanup ---------------------------------------------------------------------


def _cleanup(record: RunRecord, merge_sha: str) -> list[str]:
    """Every worktree this run created, the child issues, and the story's
    hold. `worktree:done` refuses a branch origin/main has never seen, and
    main squashes, so none of these ever satisfy it - the driver
    establishes the same fact itself and only then forces."""
    removed, kept, failures = [], [], []
    for slug, tip, landed in _cleanup_targets(record, merge_sha):
        path = worktrees.slice_worktree_path(slug)
        if path.exists() and not worktrees.is_clean(path):
            kept.append(slug)
            failures.append(f"{slug} has uncommitted work and was preserved for audit")
            continue
        code, output = worktrees.worktree_done(slug, force=landed)
        if code != 0:
            kept.append(slug)
            failures.append(f"worktree:done refused {slug}: {output}")
            continue
        removed.append(slug)
        if worktrees.branch_exists(slug):
            worktrees.delete_branch_at(slug, tip)
    _remember(record, "cleanup", {"removed": removed, "kept": kept})
    narrate.line(f"🧹 Removed {', '.join(removed) if removed else 'nothing'}")
    _close_children(record)
    return failures


def _cleanup_targets(record: RunRecord, merge_sha: str) -> list[tuple[str, str, bool]]:
    """Each worktree with the commit the record says it is at, and whether
    the driver can show that commit's work is on main. `--force` is only
    ever passed for a target whose third element is true: the squash merge
    is why `worktree:done`'s own test cannot see it, not evidence that the
    work is unlanded."""
    integration = record.delivery["integration_sha"]
    targets = [
        (
            piece.slug,
            piece.frozen_commit,
            worktrees.branch_tip(piece.slug) == piece.frozen_commit
            and worktrees.is_ancestor_of(piece.frozen_commit, integration),
        )
        for piece in record.ordered()
    ]
    branch = record.delivery["integration_branch"]
    targets.append((branch, integration, worktrees.branch_tip(branch) == integration))
    release = _ship_value(record, "release_worktree") or {}
    if release:
        targets.append(
            (
                release["slug"],
                merge_sha,
                worktrees.branch_tip(release["slug"]) == merge_sha
                and worktrees.is_ancestor_of(merge_sha, "origin/main"),
            )
        )
    return targets


def _close_children(record: RunRecord) -> None:
    note = (
        f"Delivered in PR #{record.delivery['pr_number']} "
        f"(tag {_ship_value(record, 'tag', '(untagged)')})"
    )
    for piece in record.ordered():
        github.close_issue(piece.number, note)
        narrate.line(f"🗃️  Closed #{piece.number} — {note}")
    github.remove_label(record.story_number, settings.IN_PROGRESS_LABEL)


# --- the final comment -----------------------------------------------------------


def _report_gate(story, record: RunRecord) -> None:
    try:
        _report(story, record)
    except FlowFailure as failure:
        _persist_terminal(record, failure.outcome.name)
        raise FlowFailure(failure.outcome, failure.why, record.story_number) from failure
    except Exception as error:
        _persist_terminal(record, Outcome.TOOL_FAILED.name)
        raise FlowFailure(
            Outcome.TOOL_FAILED,
            f"the release shipped but the run failed while reporting: {_describe(error)}",
            record.story_number,
        ) from error


def _deploy_line(record: RunRecord, name: str, label: str) -> str:
    result = _ship_value(record, name)
    if result is None:
        flaky = _ship_value(record, "flaky") or {}
        if flaky.get("flaky"):
            return f"{label} withheld: {flaky['why']}."
        return f"{label} withheld by configuration (FIT_FLOW_SHIP_TO=qa)."
    return f"{label} {result['origin']} ✔ smoke ok."


def _android_line(record: RunRecord) -> str:
    android = _ship_value(record, "android") or {}
    if android.get("ok"):
        return f"Android: apk {android['apk']} sha256 {android['sha256']}."
    if android.get("skipped"):
        return f"Android: skipped ({android.get('why', 'not requested')})."
    return f"Android: failed: {android.get('why', 'unknown')}."


def _report(story, record: RunRecord) -> None:
    cleanup = _ship_value(record, "cleanup") or {}
    body = (
        f"Shipped: PR #{record.delivery['pr_number']} merged "
        f"({_ship_value(record, 'merge_sha', '')[:12]}), tag "
        f"{_ship_value(record, 'tag', '(untagged)')}. "
        f"{_deploy_line(record, 'qa', 'QA')} "
        f"{_deploy_line(record, 'prod', 'Prod')} "
        f"{_android_line(record)} "
        f"Cleaned up: {', '.join(cleanup.get('removed') or ['nothing'])}. "
        "Next: pick the next story."
    )
    narrate.comment_posted(story.number, body)
    github.comment(story.number, body)
    narrate.line(f"🏁 Shipped #{story.number}")
