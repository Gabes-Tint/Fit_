"""Runs the mechanic's test files in the slice worktree and judges them from
the test runner's own JSON report, never from the process exit code (a
runner also exits non-zero for "no tests found" or a bad --project, which is
not the same failure as an acceptance test with no implementation yet).

The runner is chosen per file: `.e2e.ts` is playwright, `.py` is the
driver's own pytest suite, everything else is vitest. pytest has no JSON
reporter, so its short summary stands in for one (see the bottom of this
module); the two verdicts it produces are the same two.

What the report calls a failure is one definition, at the bottom of this
module: only `passed` is proof the expectation bit, only a skipped status
means the test never ran, and everything else - playwright's `timedOut` and
`interrupted` included - is a failure. A `toBeVisible` waiting for UI that
does not exist yet times out instead of failing an assertion, so counting
only `failed` made block 1 call a correct acceptance test "passed with no
implementation".

The report also carries every failed test's title and error message, so a
verdict names which test failed and why, and `failure_reason` can tell an
expectation that is waiting for the implementation from a test that throws
and can never pass. A verdict that nothing failed carries the opposite:
every test the runner ran, with the status it gave it."""

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from fitflow import failure_reason
from fitflow.failure_reason import Failure

TEST_FILE = re.compile(r"(\.spec\.ts|\.test\.ts|\.svelte\.spec\.ts|\.e2e\.ts)$")

#: The workflow layer's test side. Everything under it is test-side by
#: construction - the driver's flow tests are a fake world plus a `go.py`
#: run, so a new scenario needs its `given_*` helper in `conftest.py` and
#: often a scripted answer in a fake under `fakes/`, and none of that is
#: product code. The equivalent of "only test files may change" for a
#: workflow slice is therefore "only `workflow/tests/**` may change".
WORKFLOW_TESTS = "workflow/tests/"


#: A runnable acceptance test of the workflow layer. `conftest.py` and the
#: fakes are test-side too, but pytest collects neither, so neither can be
#: the file block 1 reports as an acceptance test.
WORKFLOW_ACCEPTANCE = re.compile(r"^workflow/tests/(?:[\w.-]+/)*test_[\w.-]+\.py$")


def is_test_file(layer: str, path: str) -> bool:
    """Whether block 1 may change `path` on a slice of this layer."""
    if layer == "workflow":
        return path.startswith(WORKFLOW_TESTS)
    return TEST_FILE.search(path) is not None


def matches_test_kind(test_kind: str, path: str) -> bool:
    """Whether a file block 1 changed is of the kind this slice writes: a
    playwright slice writes only `*.e2e.ts`, a vitest slice writes no
    `*.e2e.ts`, and a pytest slice writes only inside `workflow/tests/`."""
    if test_kind == "pytest":
        return path.startswith(WORKFLOW_TESTS)
    if test_kind == "playwright":
        return path.endswith(".e2e.ts")
    return not path.endswith(".e2e.ts")


def names_an_acceptance_test(test_kind: str, path: str) -> bool:
    """Whether a path block 1 *reported* as an acceptance test can be one.
    Only pytest distinguishes this from `matches_test_kind`: a fake or a
    `conftest.py` is a legitimate change and never a test pytest collects."""
    if test_kind == "pytest":
        return WORKFLOW_ACCEPTANCE.match(path) is not None
    return matches_test_kind(test_kind, path)


@dataclass(frozen=True)
class Verdict:
    """One runner check: whether it passed, the diagnostic when it did not,
    whether that diagnostic is agent-repairable, and every failed test the
    report named - carried on a passing verdict too, because block 1 accepts
    tests only after judging why they failed."""

    ok: bool
    why: str = ""
    repairable: bool = False
    failures: tuple[Failure, ...] = ()

    @property
    def defects(self) -> list[Failure]:
        return failure_reason.defects(self.failures)


def matching_path(name: str, paths: list[str]) -> str | None:
    """Which of `paths` a tool meant by `name`, or None when none of them.
    Tools report their own relative paths - jscpd's are relative to its scan
    roots, eslint's to the worktree - so a name matches by path suffix,
    never by equality alone."""
    for path in paths:
        if path == name or path.endswith(f"/{name}") or name.endswith(f"/{path}"):
            return path
    return None


def owning_test(name: str, test_files: list[str]) -> str | None:
    """Which retained acceptance test a tool blamed, or None when it blamed
    something else."""
    return matching_path(name, test_files)


def _is_e2e(path: str) -> bool:
    return path.endswith(".e2e.ts") or path.endswith(".e2e.js")


def _runner(path: str) -> str:
    """Which runner owns a test file, from its extension alone: the driver's
    own tests are Python and run under pytest, everything else is the
    repository's TypeScript."""
    if path.endswith(".py"):
        return "pytest"
    return "playwright" if _is_e2e(path) else "vitest"


def run_and_check_failing(worktree: Path, test_files: list[str]) -> Verdict:
    """An unparsable runner report is tooling failure; a missing or passing
    requested test is mechanic-repairable."""
    return _run_each(
        worktree,
        test_files,
        {"vitest": _check_vitest, "playwright": _check_playwright, "pytest": _check_pytest},
    )


def run_and_check_passing(worktree: Path, test_files: list[str]) -> Verdict:
    """The block 2 gate: every acceptance test must now run and pass.
    A real failed assertion (or a broken import) is implementation-
    repairable; an unparsable report or a file the runner never saw is a
    tooling failure, never an implementation verdict."""
    return _run_each(
        worktree,
        test_files,
        {
            "vitest": _check_vitest_passing,
            "playwright": _check_playwright_passing,
            "pytest": _check_pytest_passing,
        },
    )


def _run_each(worktree: Path, test_files: list[str], checks: dict) -> Verdict:
    """One invocation per runner the slice's test files need, in a fixed
    order so the same set of files always produces the same first verdict."""
    failures: list[Failure] = []
    for runner in ("vitest", "playwright", "pytest"):
        files = [f for f in test_files if _runner(f) == runner]
        if not files:
            continue
        verdict = checks[runner](worktree, files)
        failures.extend(verdict.failures)
        if not verdict.ok:
            return Verdict(False, verdict.why, verdict.repairable, tuple(failures))
    return Verdict(True, failures=tuple(failures))


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


_SUPPRESSIONS = ("eslint-disable", "eslint-enable", "@ts-ignore", "@ts-expect-error")


def rejects_suppression(path: Path) -> str | None:
    """Reject a lint suppression in the acceptance tests themselves. Their
    bytes become immutable inputs to implementation, so a directive that is
    only satisfied before the implementation exists (#377) can never be
    repaired afterwards: the tests must be written to pass their own lint
    both before and after the behavior lands."""
    source = path.read_text()
    for directive in _SUPPRESSIONS:
        if directive in source:
            return (
                f"{path.name} contains the lint suppression directive {directive}; "
                "fix the assertion instead - the tests must carry no suppressions "
                "and lint clean both before and after the implementation exists"
            )
    return None


_BROWSER_IMPORT = re.compile(r"\bawait\s+import\s*\(")
_EVALUATE = re.compile(r"\bevaluate\s*\(")


def rejects_browser_module_import(path: Path) -> str | None:
    """Reject a playwright spec that imports the product from the browser
    context instead of exercising it through the component harness (#380):
    a dynamic `import(...)` inside `page.evaluate` asserts that an import succeeds,
    never rendered UI, and the exercise must go through the harness route."""
    source = path.read_text()
    if _BROWSER_IMPORT.search(source) and _EVALUATE.search(source):
        return (
            f"{path.name} imports the product with page.evaluate; exercise the "
            "component through /dev/component-harness instead"
        )
    return None


def _check_vitest(worktree: Path, files: list[str]) -> Verdict:
    report = _vitest_report(worktree, files)
    if report is None:
        return Verdict(False, f"vitest produced no parsable JSON report for {', '.join(files)}")
    entries = report.get("testResults", [])
    failures: list[Failure] = []
    for f in files:
        entry = next((e for e in entries if str(e.get("name", "")).endswith(f)), None)
        failures.extend(_vitest_failures(entry, f))
        diagnostic = _check_vitest_entry(entry, entries, f)
        if diagnostic:
            return Verdict(False, diagnostic, True, tuple(failures))
    return Verdict(True, failures=tuple(failures))


def _check_vitest_entry(entry: dict | None, entries: list[dict], filename: str) -> str | None:
    """Why this file is not failing as intended, or None when it is."""
    if entry is None:
        return f"vitest never ran {filename} - no matching test file{_entries_held(entries)}"
    assertions = entry.get("assertionResults", [])
    if not assertions:
        return f"vitest {filename} failed before running any assertion"
    statuses = _vitest_statuses(assertions)
    if _all_skipped(statuses, _VITEST_SKIPPED):
        return _only_skipped("vitest", filename, statuses)
    if not any(_is_vitest_failure(status) for _, status in statuses):
        return f"vitest {filename} had no failing assertion{_saw(statuses)}"
    if not _is_vitest_failure(entry.get("status")):
        return f"vitest {filename} passed with no implementation{_saw(statuses)}"
    return None


def _check_vitest_passing(worktree: Path, files: list[str]) -> Verdict:
    report = _vitest_report(worktree, files)
    if report is None:
        return Verdict(False, f"vitest produced no parsable JSON report for {', '.join(files)}")
    entries = report.get("testResults", [])
    for f in files:
        verdict = _vitest_passing_verdict(entries, f)
        if verdict is not None:
            return verdict
    return Verdict(True)


def _vitest_passing_verdict(entries: list[dict], filename: str) -> Verdict | None:
    """Why this file is not yet proof the implementation landed, or None
    when every one of its tests really ran and passed."""
    entry = next((e for e in entries if str(e.get("name", "")).endswith(filename)), None)
    if entry is None:
        why = f"vitest never ran {filename} - no matching test file{_entries_held(entries)}"
        return Verdict(False, why)
    assertions = entry.get("assertionResults", [])
    if not assertions:
        return Verdict(False, f"vitest {filename} failed before running any assertion", True)
    statuses = _vitest_statuses(assertions)
    if _all_skipped(statuses, _VITEST_SKIPPED):
        return Verdict(False, _only_skipped("vitest", filename, statuses), True)
    if _vitest_entry_passed(entry, statuses):
        return None
    failures = _vitest_failures(entry, filename)
    return Verdict(False, _still_failing("vitest", filename, failures), True, tuple(failures))


def _vitest_entry_passed(entry: dict, statuses: list[tuple[str, str]]) -> bool:
    """Proof, not the absence of a red mark: the file's own status says
    passed and no single assertion says otherwise."""
    return entry.get("status") == _PASSED and not any(
        _is_vitest_failure(status) for _, status in statuses
    )


def _check_playwright(worktree: Path, files: list[str]) -> Verdict:
    report = _playwright_report(worktree, files)
    if report is None:
        return Verdict(False, f"playwright produced no parsable JSON report for {', '.join(files)}")
    specs = list(_flatten_specs(report.get("suites", [])))
    failures: list[Failure] = []
    for f in files:
        matching = [spec for spec in specs if str(spec.get("file", "")).endswith(f)]
        failures.extend(_playwright_failures(matching, report, f))
        diagnostic = _check_playwright_specs(matching, specs, f)
        if diagnostic:
            return Verdict(False, diagnostic, True, tuple(failures))
    return Verdict(True, failures=tuple(failures))


def _check_playwright_specs(matching: list[dict], specs: list[dict], filename: str) -> str | None:
    """Why these specs are not failing as intended, or None when they are."""
    if not matching:
        return f"playwright never ran {filename} - no matching spec{_specs_held(specs)}"
    if _any_failed(matching):
        return None
    statuses = _playwright_statuses(matching)
    if not statuses or _all_skipped(statuses, _PLAYWRIGHT_SKIPPED):
        return _only_skipped("playwright", filename, statuses)
    return f"playwright {filename} passed with no implementation{_saw(statuses)}"


def _check_playwright_passing(worktree: Path, files: list[str]) -> Verdict:
    report = _playwright_report(worktree, files)
    if report is None:
        return Verdict(False, f"playwright produced no parsable JSON report for {', '.join(files)}")
    specs = list(_flatten_specs(report.get("suites", [])))
    for f in files:
        verdict = _playwright_passing_verdict(specs, report, f)
        if verdict is not None:
            return verdict
    return Verdict(True)


def _playwright_passing_verdict(specs: list[dict], report: dict, filename: str) -> Verdict | None:
    """Why this file is not yet proof the implementation landed, or None
    when every one of its tests really ran and passed."""
    matching = [spec for spec in specs if str(spec.get("file", "")).endswith(filename)]
    if not matching:
        why = f"playwright never ran {filename} - no matching spec{_specs_held(specs)}"
        return Verdict(False, why)
    statuses = _playwright_statuses(matching)
    if _all_skipped(statuses, _PLAYWRIGHT_SKIPPED):
        return Verdict(False, _only_skipped("playwright", filename, statuses), True)
    if _all_passed(matching):
        return None
    failures = _playwright_failures(matching, report, filename)
    return Verdict(False, _still_failing("playwright", filename, failures), True, tuple(failures))


def _still_failing(runner: str, filename: str, failures: list[Failure]) -> str:
    """The implementer only learns what to fix when the diagnostic carries
    the runner's own words: which test, and the message it failed with."""
    detail = failure_reason.describe(failures)
    tail = f": {detail}" if detail else ""
    return f"{runner} {filename} still fails, the implementation is not done yet{tail}"


def _only_skipped(runner: str, filename: str, statuses: list[tuple[str, str]]) -> str:
    """A file whose every test was skipped is as good as one that never
    ran: it is neither passing nor failing and proves nothing either way,
    so it is rejected rather than read as one or the other."""
    return f"{runner} {filename} only skipped its tests, so none of them ran{_saw(statuses)}"


def _saw(statuses: list[tuple[str, str]]) -> str:
    """What the runner reported for each test. A rejection that only says
    nothing failed leaves the mechanic guessing which assertion did not
    bite, so the diagnostic carries the runner's own per-test verdict, one
    per line - `narrate.headed` keeps the head line short and prints the
    rest as a block."""
    if not statuses:
        return ""
    lines = "\n".join(f'"{title}" → {status or "unknown"}' for title, status in statuses)
    return f"; the runner reported:\n{lines}"


def _specs_held(specs: list[dict]) -> str:
    return _report_held([str(spec.get("file") or "") for spec in specs])


def _entries_held(entries: list[dict]) -> str:
    return _report_held([str(entry.get("name") or "") for entry in entries])


def _report_held(names: list[str]) -> str:
    """Which files the report did contain. A requested file that matched
    nothing is usually a file the runner knows under another name, and the
    mechanic can only see that when the rejection names both."""
    present = sorted({name for name in names if name})
    if not present:
        return "; the report contained no test file at all"
    return "; the report contained:\n" + "\n".join(present)


def _vitest_report(worktree: Path, files: list[str]) -> dict | None:
    return _run_report(worktree, ["bun", "x", "vitest", "run", "--reporter=json", *files])


def _playwright_report(worktree: Path, files: list[str]) -> dict | None:
    return _run_report(
        worktree,
        ["bun", "x", "playwright", "test", *files, "--project=mobile-chrome", "--reporter=json"],
    )


def _run_report(worktree: Path, command: list[str]) -> dict | None:
    result = subprocess.run(command, cwd=worktree, capture_output=True, text=True)
    return _parse_json(result.stdout)


def _vitest_failures(entry: dict | None, filename: str) -> list[Failure]:
    """vitest reports a failed test's messages in `failureMessages`, and a
    file that died before any assertion only in the entry's own `message`."""
    if entry is None:
        return []
    assertions = entry.get("assertionResults") or []
    if not assertions:
        return [Failure(filename, "", str(entry.get("message") or ""))]
    failures = []
    for assertion in assertions:
        if not _is_vitest_failure(assertion.get("status")):
            continue
        title = str(assertion.get("title") or assertion.get("fullName") or "")
        messages = assertion.get("failureMessages") or [""]
        failures.extend(Failure(filename, title, str(message)) for message in messages)
    return failures


def _vitest_statuses(assertions: list[dict]) -> list[tuple[str, str]]:
    """Every (test title, status) the report carried, in report order."""
    return [
        (
            str(assertion.get("title") or assertion.get("fullName") or ""),
            str(assertion.get("status") or ""),
        )
        for assertion in assertions
    ]


def _playwright_failures(specs: list[dict], report: dict, filename: str) -> list[Failure]:
    """Playwright reports a failed attempt's error under the spec's result,
    and a file that never loaded only in the report's top-level `errors`."""
    failures = [
        _playwright_failure(spec, result, filename)
        for spec, result in _playwright_results(specs)
        if _is_playwright_failure(result.get("status"))
    ]
    failures.extend(_load_failures(report, filename))
    return failures


def _playwright_failure(spec: dict, result: dict, filename: str) -> Failure:
    error = result.get("error") or next(iter(result.get("errors") or []), {})
    return Failure(
        filename,
        str(spec.get("title") or ""),
        str(error.get("message") or ""),
        _error_location(result, error),
    )


def _error_location(result: dict, error: dict) -> str:
    for location in (error.get("location"), result.get("errorLocation")):
        if isinstance(location, dict) and location.get("file"):
            return str(location["file"])
    return ""


def _load_failures(report: dict, filename: str) -> list[Failure]:
    """A spec that never loaded produces no result at all; its error sits at
    the top of the report, attributed by the location it names."""
    failures = []
    for error in report.get("errors") or []:
        location = error.get("location") if isinstance(error, dict) else None
        where = str(location.get("file", "")) if isinstance(location, dict) else ""
        message = str(error.get("message") or "") if isinstance(error, dict) else ""
        if where.endswith(filename) or (not where and filename in message):
            failures.append(Failure(filename, "", message, where))
    return failures


def _flatten_specs(suites: list[dict]):
    for suite in suites:
        yield from suite.get("specs", [])
        yield from _flatten_specs(suite.get("suites", []))


def _playwright_results(specs: list[dict]):
    """Every (spec, result) pair the report carried, in report order."""
    for spec in specs:
        for test in spec.get("tests", []):
            yield from ((spec, result) for result in test.get("results", []))


def _playwright_statuses(specs: list[dict]) -> list[tuple[str, str]]:
    """Every (test title, status) the report carried, in report order."""
    return [
        (str(spec.get("title") or ""), str(result.get("status") or ""))
        for spec, result in _playwright_results(specs)
    ]


# One definition of what each runner calls a test that did not prove its
# expectation. A result is proof the behavior is there only when the runner
# says `passed`, and proof that nothing was tried only when it says the test
# was skipped; every other status is a failure. Playwright reports a test
# that ran out of time as `timedOut` and one abandoned because another test
# failed as `interrupted` - and an expectation waiting for UI that does not
# exist yet times out rather than failing an assertion, which is the
# ordinary shape of a block 1 acceptance test failing exactly as intended.
# Counting only `failed` read that as "passed with no implementation" and
# rejected a correct test. A result carrying no status at all judges nothing.
_PASSED = "passed"
_PLAYWRIGHT_SKIPPED = ("skipped",)
_VITEST_SKIPPED = ("pending", "skipped", "todo")


def _is_failure(status: object, skipped: tuple[str, ...]) -> bool:
    return bool(status) and status != _PASSED and status not in skipped


def _is_playwright_failure(status: object) -> bool:
    return _is_failure(status, _PLAYWRIGHT_SKIPPED)


def _is_vitest_failure(status: object) -> bool:
    return _is_failure(status, _VITEST_SKIPPED)


def _all_skipped(statuses: list[tuple[str, str]], skipped: tuple[str, ...]) -> bool:
    return bool(statuses) and all(status in skipped for _, status in statuses)


def _any_failed(specs: list[dict]) -> bool:
    return any(_is_playwright_failure(status) for _, status in _playwright_statuses(specs))


def _all_passed(specs: list[dict]) -> bool:
    """Proof, not the absence of failure: a spec with no result at all, or
    one whose tests were only skipped, passed nothing."""
    statuses = _playwright_statuses(specs)
    return bool(statuses) and all(status == _PASSED for _, status in statuses)


# --- the driver's own tests ------------------------------------------------
#
# pytest has no JSON reporter, so the report is its own short summary:
# `-rA` prints one `PASSED`/`FAILED`/`ERROR` line per test, `--tb=short`
# puts the reason on the `FAILED` line, and a collection or import error
# appears as an `ERROR` line naming the file, with the exception in the
# `E ` frames of the traceback above it. That summary is as much of a
# report as the JSON ones: a run that produced none of it never judged
# anything, and that is a tooling failure, exactly like a vitest report
# that will not parse.

_PYTEST_ARGV = ["uv", "run", "--project", "workflow", "pytest", "-q", "-rA", "--tb=short"]
#: pytest truncates its short-summary lines to the terminal width, and a
#: captured pipe is 80 columns, which cuts every message off mid-word. The
#: driver reads those lines, so it asks for a width that fits them.
_PYTEST_COLUMNS = "200"
_PYTEST_STATUS = {"PASSED": "passed", "FAILED": "failed", "ERROR": "error"}
_PYTEST_RAN = re.compile(
    r"(no tests ran|\d+ (?:passed|failed|error|errors|skipped|deselected)"
    r"|file or directory not found)"
)
_ERROR_FRAME = re.compile(r"^E\s+(\S.*)$")
_ERROR_FRAMES = 3


def _check_pytest(worktree: Path, files: list[str]) -> Verdict:
    entries = _pytest_report(worktree, files)
    if entries is None:
        return Verdict(False, f"pytest produced no readable summary for {', '.join(files)}")
    collection = _collection_error(entries)
    if collection:
        return Verdict(False, collection, True)
    failures: list[Failure] = []
    for f in files:
        matching = [entry for entry in entries if _same_file(entry["file"], f)]
        failures.extend(_pytest_failures(matching, f))
        diagnostic = _check_pytest_entries(matching, f)
        if diagnostic:
            return Verdict(False, diagnostic, True, tuple(failures))
    return Verdict(True, failures=tuple(failures))


def _check_pytest_passing(worktree: Path, files: list[str]) -> Verdict:
    entries = _pytest_report(worktree, files)
    if entries is None:
        return Verdict(False, f"pytest produced no readable summary for {', '.join(files)}")
    collection = _collection_error(entries)
    if collection:
        return Verdict(False, collection, True)
    for f in files:
        matching = [entry for entry in entries if _same_file(entry["file"], f)]
        if not matching:
            return Verdict(False, f"pytest never ran {f} - no matching test file")
        if any(entry["status"] != "passed" for entry in matching):
            failures = _pytest_failures(matching, f)
            return Verdict(False, _still_failing("pytest", f, failures), True, tuple(failures))
    return Verdict(True)


def _check_pytest_entries(matching: list[dict], filename: str) -> str | None:
    if not matching:
        return f"pytest never ran {filename} - no matching test file"
    if not any(entry["status"] == "failed" for entry in matching):
        return f"pytest {filename} passed with no implementation"
    return None


def _collection_error(entries: list[dict]) -> str | None:
    """A module pytest could not even import never ran an assertion, so it
    is not a test failing for want of the implementation - it is a broken
    test, and it comes back to the mechanic as one. A collection error also
    interrupts the whole run, so it is judged before any per-file verdict:
    the other requested files did not "go missing", they never got a turn."""
    error = next((entry for entry in entries if entry["status"] == "error"), None)
    if error is None:
        return None
    return (
        f"pytest could not collect {error['file']}: {error['message'] or '(no error message)'}"
        " - a collection or import error is not a test failing because the behavior is missing"
    )


def _pytest_failures(matching: list[dict], filename: str) -> list[Failure]:
    """No error location: pytest's short summary carries the message but not
    the frame that raised it, and `blames_the_test` must never conclude that
    a thrown error is the acceptance test's fault without one."""
    return [
        Failure(filename, entry["title"], entry["message"])
        for entry in matching
        if entry["status"] != "passed"
    ]


def _same_file(reported: str, requested: str) -> bool:
    """pytest spells a path relative to its own rootdir, which is not always
    the repository root, so a reported path matches by suffix."""
    if reported == requested:
        return True
    return reported.endswith(f"/{requested}") or requested.endswith(f"/{reported}")


def _pytest_report(worktree: Path, files: list[str]) -> list[dict] | None:
    result = subprocess.run(
        [*_PYTEST_ARGV, *files],
        cwd=worktree,
        capture_output=True,
        text=True,
        env={**os.environ, "COLUMNS": _PYTEST_COLUMNS},
    )
    output = f"{result.stdout}\n{result.stderr}"
    entries = _pytest_entries(output)
    if entries:
        return entries
    return [] if _PYTEST_RAN.search(output) else None


def _pytest_entries(output: str) -> list[dict]:
    detail = _pytest_error_detail(output)
    entries = []
    for line in output.splitlines():
        head, _, rest = line.partition(" ")
        status = _PYTEST_STATUS.get(head)
        if status is None or not rest.strip():
            continue
        entries.append(_pytest_entry(status, rest.strip(), detail))
    return entries


def _pytest_entry(status: str, rest: str, detail: str) -> dict:
    nodeid, _, message = rest.partition(" - ")
    name, _, title = nodeid.partition("::")
    return {
        "file": name,
        "title": title,
        "status": status,
        "message": message.strip() or (detail if status == "error" else ""),
    }


def _pytest_error_detail(output: str) -> str:
    """The exception behind a collection error. pytest's short summary
    prints the failing file with no reason at all, and the only place the
    reason appears is the `E ` frames of the traceback above it."""
    frames = [
        match.group(1)
        for line in output.splitlines()
        if (match := _ERROR_FRAME.match(line)) is not None
    ]
    return "; ".join(frames[-_ERROR_FRAMES:])
