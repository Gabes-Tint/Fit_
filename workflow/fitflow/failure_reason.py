"""Why a failing acceptance test failed.

A test that fails because the behavior is missing is the point of block 1. A
test that throws instead - a helper called with an argument of the wrong type
(#399), a name that does not exist, a syntax error - looks identical in an
exit code and can never pass, whatever the implementation does. Only the
runner's own error message tells the two apart, so every failure message is
classified before the driver accepts the tests or blames an implementation.

A module or export that cannot be resolved is not a defect: the sanctioned
pattern for a module that does not exist yet is a dynamic import inside the
assertion, and that rejection is precisely the missing behavior.
"""

import re
from dataclasses import dataclass

DEFECT = "defect"
EXPECTATION = "expectation"

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_FRAME = re.compile(r"([\w./@-]+\.(?:ts|js|svelte)):\d+:\d+")
_SUMMARY_LIMIT = 300
_DESCRIBED_LIMIT = 3

_EXPECTATION_OPENERS = (
    "error: expect",
    "expect(",
    "expect.",
    "assertionerror",
    "expected ",
)
_EXPECTATION_PHRASES = ("waiting for expect", "waiting for locator")
_RESOLUTION = (
    "cannot find module",
    "cannot find package",
    "failed to resolve import",
    "failed to load url",
    "err_module_not_found",
    "does not provide an export named",
)
_DEFECTS = (
    "typeerror",
    "referenceerror",
    "syntaxerror",
    "is not a function",
    "is not defined",
    "is not iterable",
    "cannot read properties",
    "cannot read property",
    "cannot destructure",
)


@dataclass(frozen=True)
class Failure:
    """One failed test as the runner reported it: which file, which test
    title, the error message, and where the error was thrown when the
    report says so."""

    file: str
    title: str
    message: str
    where: str = ""

    @property
    def reason(self) -> str:
        return classify(self.message)

    @property
    def source(self) -> str:
        return self.where or _first_frame(self.message)

    def described(self) -> str:
        return f'{self.file} "{self.title or "(untitled test)"}": {summary(self.message)}'


def classify(message: str) -> str:
    text = _plain(message).strip().lower()
    if not text:
        return EXPECTATION
    if text.startswith(_EXPECTATION_OPENERS):
        return EXPECTATION
    if any(phrase in text for phrase in _EXPECTATION_PHRASES):
        return EXPECTATION
    if any(marker in text for marker in _RESOLUTION):
        return EXPECTATION
    if any(marker in text for marker in _DEFECTS):
        return DEFECT
    return EXPECTATION


def defects(failures) -> list[Failure]:
    return [failure for failure in failures if failure.reason == DEFECT]


def describe(failures) -> str:
    return "; ".join(failure.described() for failure in list(failures)[:_DESCRIBED_LIMIT])


def blames_the_test(failure: Failure, test_files: list[str]) -> bool:
    """During implementation a thrown error indicts the acceptance test only
    when it was thrown inside that test or a test helper. Product code
    throwing a TypeError is an implementation bug, and the implementer's own
    correction loop owns it."""
    source = failure.source
    if not source:
        return False
    return any(source.endswith(name) for name in test_files) or _is_test_support(source)


def summary(message: str) -> str:
    for line in _plain(message).splitlines():
        if line.strip():
            return line.strip()[:_SUMMARY_LIMIT]
    return "(no error message)"


def _is_test_support(source: str) -> bool:
    return source.startswith("tests/") or "/tests/" in source


def _first_frame(message: str) -> str:
    match = _FRAME.search(_plain(message))
    return match.group(1) if match else ""


def _plain(message: str) -> str:
    return _ANSI.sub("", message or "")
