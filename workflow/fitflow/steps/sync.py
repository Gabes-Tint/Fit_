"""Box: git fetch origin - step 0 of block 1."""

import subprocess

from fitflow import narrate, settings


def sync() -> None:
    subprocess.run(
        ["git", "fetch", "origin"],
        cwd=settings.FIT_REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    narrate.line("📥 Sync: fetched origin")
