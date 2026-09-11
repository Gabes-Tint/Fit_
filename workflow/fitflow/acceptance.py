"""Runs the mechanic's test files in the slice worktree and judges them from
the test runner's own JSON report, never from the process exit code (a
runner also exits non-zero for "no tests found" or a bad --project, which is
not the same failure as an acceptance test with no implementation yet)."""

import json
import subprocess
from pathlib import Path


def _is_e2e(path: str) -> bool:
    return path.endswith(".e2e.ts") or path.endswith(".e2e.js")


def run_and_check_failing(worktree: Path, test_files: list[str]) -> tuple[bool, str]:
    """(True, "") if every file failed, as an acceptance test with no
    implementation yet must. (False, why) the first time one does not."""
    vitest_files = [f for f in test_files if not _is_e2e(f)]
    e2e_files = [f for f in test_files if _is_e2e(f)]
    if vitest_files:
        ok, why = _check_vitest(worktree, vitest_files)
        if not ok:
            return False, why
    if e2e_files:
        ok, why = _check_playwright(worktree, e2e_files)
        if not ok:
            return False, why
    return True, ""


def _parse_json(stdout: str) -> dict | None:
    try:
        return json.loads(stdout)
    except (ValueError, TypeError):
        return None


def _check_vitest(worktree: Path, files: list[str]) -> tuple[bool, str]:
    result = subprocess.run(
        ["bun", "x", "vitest", "run", "--reporter=json", *files],
        cwd=worktree,
        capture_output=True,
        text=True,
    )
    report = _parse_json(result.stdout)
    if report is None:
        return False, f"vitest produced no parsable JSON report for {', '.join(files)}"
    entries = report.get("testResults", [])
    for f in files:
        entry = next((e for e in entries if str(e.get("name", "")).endswith(f)), None)
        if entry is None:
            return False, f"vitest never ran {f} - no matching test file"
        if entry.get("status") != "failed":
            return False, f"vitest {f} passed with no implementation"
    return True, ""


def _check_playwright(worktree: Path, files: list[str]) -> tuple[bool, str]:
    result = subprocess.run(
        ["bun", "x", "playwright", "test", *files, "--project=mobile-chrome", "--reporter=json"],
        cwd=worktree,
        capture_output=True,
        text=True,
    )
    report = _parse_json(result.stdout)
    if report is None:
        return False, f"playwright produced no parsable JSON report for {', '.join(files)}"
    specs = list(_flatten_specs(report.get("suites", [])))
    for f in files:
        matching = [spec for spec in specs if str(spec.get("file", "")).endswith(f)]
        if not matching:
            return False, f"playwright never ran {f} - no matching spec"
        if not _any_failed(matching):
            return False, f"playwright {f} passed with no implementation"
    return True, ""


def _flatten_specs(suites: list[dict]):
    for suite in suites:
        yield from suite.get("specs", [])
        yield from _flatten_specs(suite.get("suites", []))


def _any_failed(specs: list[dict]) -> bool:
    for spec in specs:
        for test in spec.get("tests", []):
            for result in test.get("results", []):
                if result.get("status") == "failed":
                    return True
    return False
