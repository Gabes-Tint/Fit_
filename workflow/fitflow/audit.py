"""Tracks what this run has created, so a failure after the story is held
can tell whoever reads the comment exactly what to undo. Reset per process
(each run is its own `go.py` invocation), so plain module state is enough.
"""

_story_number: int | None = None
_held = False
_children: list[tuple[int, str]] = []
_worktrees: list[str] = []


def picked(number: int) -> None:
    global _story_number
    _story_number = number


def story_number() -> int | None:
    return _story_number


def held() -> None:
    global _held
    _held = True


def child_created(number: int, layer: str) -> None:
    _children.append((number, layer))


def worktree_created(name: str) -> None:
    """name is a team/branch name, `issue-<n>` - only ever recorded for a
    worktree this run actually created (`fitflow.teams`), never one it
    merely reused from an earlier run."""
    _worktrees.append(name)


def reset_instructions() -> str:
    """What to undo, in the order it was created. Empty before anything
    was created (a failure that never got past whose call, say)."""
    lines = []
    if _held and _story_number is not None:
        lines.append(f"- remove the `in-progress` label from #{_story_number}")
    for number, layer in _children:
        lines.append(f"- close child #{number} ({layer})")
    for name in _worktrees:
        lines.append(
            f"- `bun run worktree:done {name} --force` and `git push origin --delete {name}`; "
            f"then `aarmy delete --team {name}` and remove `$FIT_FLOW_HOME/{name}`"
        )
    return "\n".join(lines)
