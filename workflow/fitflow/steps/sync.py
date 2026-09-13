"""Box: git fetch origin - step 0 of block 1."""

from fitflow import narrate, worktrees


def sync() -> None:
    worktrees.fetch_origin()
    narrate.line("📥 Sync: fetched origin")
