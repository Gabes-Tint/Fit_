"""Runs the mechanic's test files in the slice worktree and judges them from
the test runner's own JSON report, never from the process exit code (a
runner also exits non-zero for "no tests found" or a bad --project, which is
not the same failure as an acceptance test with no implementation yet)."""

import json
import re
import subprocess
from pathlib import Path


def _is_e2e(path: str) -> bool:
    return path.endswith(".e2e.ts") or path.endswith(".e2e.js")


def run_and_check_failing(worktree: Path, test_files: list[str]) -> tuple[bool, str, bool]:
    """Return (ok, diagnostic, repairable). An unparsable runner report is
    tooling failure; a missing or passing requested test is mechanic-repairable."""
    vitest_files = [f for f in test_files if not _is_e2e(f)]
    e2e_files = [f for f in test_files if _is_e2e(f)]
    if vitest_files:
        ok, why, repairable = _check_vitest(worktree, vitest_files)
        if not ok:
            return False, why, repairable
    if e2e_files:
        ok, why, repairable = _check_playwright(worktree, e2e_files)
        if not ok:
            return False, why, repairable
    return True, "", False


def _parse_json(stdout: str) -> dict | None:
    decoder = json.JSONDecoder()
    candidates = []
    for match in re.finditer(r"[\[{]", stdout):
        try:
            value, end = decoder.raw_decode(stdout, match.start())
        except (ValueError, TypeError):
            continue
        if isinstance(value, dict) and not stdout[end:].strip():
            candidates.append(value)
    if candidates:
        return candidates[-1]
    try:
        return json.loads(stdout)
    except (ValueError, TypeError):
        return None


def rejects_local_stand_in(path: Path) -> str | None:
    """Reject an asserted callable defined in a test with no product import."""
    source = path.read_text()
    imports = re.findall(r"\bfrom\s+['\"]([^'\"]+)['\"]", source)
    product_imports = [item for item in imports if item not in {"vitest", "@playwright/test"}]
    if product_imports:
        return None
    declarations = set(
        re.findall(r"\b(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*=>", source)
        + re.findall(r"\bfunction\s+(\w+)\s*\(", source)
    )
    for name in sorted(declarations):
        if re.search(rf"\bexpect\s*\([^)]*\b{re.escape(name)}\s*\(", source):
            return (
                f"{path.name} defines and asserts local stand-in callable {name} "
                "without importing product code"
            )
    return None


def _check_vitest(worktree: Path, files: list[str]) -> tuple[bool, str, bool]:
    result = subprocess.run(
        ["bun", "x", "vitest", "run", "--reporter=json", *files],
        cwd=worktree,
        capture_output=True,
        text=True,
    )
    report = _parse_json(result.stdout)
    if report is None:
        return False, f"vitest produced no parsable JSON report for {', '.join(files)}", False
    entries = report.get("testResults", [])
    for f in files:
        entry = next((e for e in entries if str(e.get("name", "")).endswith(f)), None)
        diagnostic = _check_vitest_entry(entry, f)
        if diagnostic:
            return False, diagnostic, True
    return True, "", False


def _check_vitest_entry(entry: dict | None, filename: str) -> str | None:
    if entry is None:
        return f"vitest never ran {filename} - no matching test file"
    assertions = entry.get("assertionResults", [])
    if not assertions:
        return f"vitest {filename} failed before running any assertion"
    if not any(assertion.get("status") == "failed" for assertion in assertions):
        return f"vitest {filename} had no failing assertion"
    if entry.get("status") != "failed":
        return f"vitest {filename} passed with no implementation"
    return None


def _check_playwright(worktree: Path, files: list[str]) -> tuple[bool, str, bool]:
    result = subprocess.run(
        ["bun", "x", "playwright", "test", *files, "--project=mobile-chrome", "--reporter=json"],
        cwd=worktree,
        capture_output=True,
        text=True,
    )
    report = _parse_json(result.stdout)
    if report is None:
        return (
            False,
            f"playwright produced no parsable JSON report for {', '.join(files)}",
            False,
        )
    specs = list(_flatten_specs(report.get("suites", [])))
    for f in files:
        matching = [spec for spec in specs if str(spec.get("file", "")).endswith(f)]
        if not matching:
            return False, f"playwright never ran {f} - no matching spec", True
        if not _any_failed(matching):
            return False, f"playwright {f} passed with no implementation", True
    return True, "", False


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
