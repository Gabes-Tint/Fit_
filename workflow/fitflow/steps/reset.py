"""Box: reset - undo what a run created for a story, so a fresh run can
begin. The one deliberately destructive command in the driver: it says
what every worktree held before removing it, and it archives the run's
record rather than deleting it.

What it undoes: the slice, integration and release worktrees and their
local and remote branches; the AI Army teams; an open pull request (a
merged one is left alone: its work landed); the child issues block 1
created; and the `in-progress` and `blocked` labels. `needs-gabriel` and
`paused` are human holds and stay. Block 1 creates the record as soon as
the plan is accepted, so a run that died writing its tests is reset from it
like any other; without one - a record lost or removed by hand - the same
things are found by their names.
"""

from fitflow import agents, github, layers, narrate, runstate, settings, worktrees
from fitflow.outcome import FlowFailure, Outcome
from fitflow.runstate import RunRecord

_NOTE = "Reset by `go.py --reset`"


def run(issue: int) -> Outcome:
    try:
        story = github.view(issue)
    except RuntimeError as error:
        raise FlowFailure(Outcome.CANNOT_PICK, f"#{issue} does not exist: {error}") from error
    with runstate.story_lock(issue):
        record = runstate.load_run(issue) if runstate.has_run(issue) else None
        narrate.line(
            f"🧹 Resetting #{issue} "
            f"({'from its retained record' if record else 'no retained record: by name'})"
        )
        children = _children(issue, record)
        done = []
        done += _close_open_pr(record)
        done += _remove_worktrees(issue, record, children)
        done += _delete_teams(issue, record, children)
        done += _close_children(issue, children)
        done += _release_labels(story)
        archived = runstate.archive_run(issue)
        if archived:
            done.append(f"archived the run record at `{archived}`")
            narrate.line(f"🗄️  Archived the run record at {archived}")
        body = f"{_NOTE}:\n" + "\n".join(f"- {item}" for item in done)
        narrate.comment_posted(issue, body)
        github.comment(issue, body)
        narrate.line(f"🏁 Reset #{issue}: {len(done)} things undone")
    return Outcome.RESET


def _close_open_pr(record: RunRecord | None) -> list[str]:
    if record is None or not record.delivery.get("pr_number"):
        return []
    number = int(record.delivery["pr_number"])
    state = github.view_pr(number).state
    if state != "OPEN":
        narrate.line(f"📥 PR #{number} is {state}: left as it is")
        return [f"left PR #{number} ({state.lower()})"]
    github.close_pr(number, f"{_NOTE} of #{record.story_number}.")
    narrate.line(f"📥 Closed PR #{number}")
    return [f"closed PR #{number}"]


def _children(issue: int, record: RunRecord | None) -> list[int]:
    if record is not None:
        return [piece.number for piece in record.ordered() if piece.number != issue]
    return github.children_of(issue)


def _slice_slugs(issue: int, record: RunRecord | None, children: list[int]) -> list[str]:
    """The slice worktrees, teams and branches: from the record, or by the
    names block 1 gives them - `story-<n>-<layer>` on the story itself or
    on each child."""
    if record is not None:
        return [piece.slug for piece in record.ordered()]
    numbers = (issue, *children)
    return [f"story-{number}-{layer}" for number in numbers for layer in layers.LAYERS]


def _slugs(issue: int, record: RunRecord | None, children: list[int]) -> list[str]:
    slugs = _slice_slugs(issue, record, children)
    delivery = record.delivery if record is not None else {}
    slugs.append(delivery.get("integration_branch") or f"story-{issue}")
    release = delivery.get("ship", {}).get("release_worktree") or {}
    slugs.append(release.get("slug") or f"release-story-{issue}")
    return slugs


def _remove_worktrees(issue: int, record: RunRecord | None, children: list[int]) -> list[str]:
    done = []
    for slug in _slugs(issue, record, children):
        path = worktrees.slice_worktree_path(slug)
        if path.exists():
            state = worktrees.status_summary(path, dirty="removed; uncommitted changes were")
            narrate.line(f"🗑️  {slug} worktree: {state}")
            code, output = worktrees.worktree_done(slug, force=True)
            if code != 0:
                narrate.line(f"   │ worktree:done refused ({output}); removing with git")
                worktrees.remove_slice_worktree(path)
            done.append(f"removed worktree `{slug}`")
        if worktrees.branch_exists(slug) and worktrees.delete_local_branch(slug):
            done.append(f"deleted local branch `{slug}`")
        if worktrees.remote_head(slug) is not None and worktrees.delete_remote_branch(slug):
            narrate.line(f"🌐 Deleted {slug} on origin")
            done.append(f"deleted `{slug}` on origin")
    return done


def _delete_teams(issue: int, record: RunRecord | None, children: list[int]) -> list[str]:
    teams = _slice_slugs(issue, record, children)
    teams += [f"story-{issue}-review", f"plan-{issue}"]
    removed = []
    for team in teams:
        if (settings.TEAMS_DIR / team).exists():
            agents.delete_team(team)
            removed.append(team)
    return [f"deleted team `{team}`" for team in removed]


def _close_children(issue: int, children: list[int]) -> list[str]:
    for child in children:
        github.close_issue(child, f"{_NOTE} of #{issue}.")
        narrate.line(f"🗃️  Closed child #{child}")
    return [f"closed child #{child}" for child in children]


def _release_labels(story) -> list[str]:
    done = []
    for label in (settings.IN_PROGRESS_LABEL, settings.BLOCKED_LABEL):
        if label in story.labels:
            github.remove_label(story.number, label)
            narrate.line(f"✏️  #{story.number} label {label} removed")
            done.append(f"removed label `{label}`")
    return done
