"""Runs the mechanic's test files in the slice worktree and reports whether
they fail, the way they must until the slice is implemented.
"""

import subprocess
from pathlib import Path


def _is_e2e(path: str) -> bool:
    return path.endswith(".e2e.ts") or path.endswith(".e2e.js")


def run_and_check_failing(worktree: Path, test_files: list[str]) -> bool:
    """True if every scripted test run failed (as an acceptance test with
    no implementation yet must). False if any run passed."""
    vitest_files = [f for f in test_files if not _is_e2e(f)]
    e2e_files = [f for f in test_files if _is_e2e(f)]
    vitest_passed = vitest_files and _passed(["bun", "x", "vitest", "run", *vitest_files], worktree)
    e2e_passed = e2e_files and _passed(
        ["bun", "x", "playwright", "test", *e2e_files, "--project=chromium"], worktree
    )
    return not (vitest_passed or e2e_passed)


def _passed(cmd: list[str], worktree: Path) -> bool:
    """True means the command exited zero - i.e. the tests passed, which an
    acceptance test with no implementation yet must not do."""
    result = subprocess.run(cmd, cwd=worktree, capture_output=True, text=True)
    return result.returncode == 0
