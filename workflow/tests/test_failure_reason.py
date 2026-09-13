"""Unit tests for the failure classifier: which runner messages mean the
behavior is still missing, and which mean the test itself is broken."""

import pytest

from fitflow import failure_reason
from fitflow.failure_reason import DEFECT, EXPECTATION, Failure

EXPECTATIONS = [
    "Error: expect(received).toBeVisible()\n\nLocator: getByRole('heading')",
    "AssertionError: expected undefined to be 42 // Object.is equality",
    "expected 3 to be 4",
    "Timed out 5000ms waiting for expect(locator).toHaveText('kg')",
    # the module a dynamic import reaches for does not exist yet: that is
    # exactly the missing behavior block 1 asks the mechanic to assert
    "Error: Failed to resolve import './units' from 'src/lib/x.spec.ts'",
    "Error: Cannot find module './units'",
    "SyntaxError: The requested module './units' does not provide an export named 'toKg'",
    # a preview server that never answered is a tooling problem, not a
    # broken test
    "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4173/",
]

DEFECTS = [
    "TypeError: locator.boundingBox is not a function",
    "ReferenceError: expectFitsViewport is not defined",
    "SyntaxError: Unexpected token ')'",
    "TypeError: Cannot read properties of undefined (reading 'units')",
]


@pytest.mark.parametrize("message", EXPECTATIONS)
def test_a_failed_expectation_is_not_a_defect(message):
    assert failure_reason.classify(message) == EXPECTATION


@pytest.mark.parametrize("message", DEFECTS)
def test_a_thrown_error_is_a_defect(message):
    assert failure_reason.classify(message) == DEFECT


def test_an_expectation_wins_over_a_defect_word_inside_its_diff():
    message = (
        "Error: expect(received).toEqual(expected)\n\n"
        "- Expected\n+ Received\n- TypeError: nothing here\n"
    )

    assert failure_reason.classify(message) == EXPECTATION


def test_a_message_with_colour_codes_is_classified_on_its_text():
    message = "\x1b[31mTypeError\x1b[39m: locator.boundingBox is not a function"

    assert failure_reason.classify(message) == DEFECT


def test_an_empty_message_is_never_a_defect():
    assert failure_reason.classify("") == EXPECTATION


def test_the_description_names_the_file_the_test_and_the_message():
    failure = Failure(
        "src/routes/progress.e2e.ts",
        "renders at 360px viewport width",
        "TypeError: locator.boundingBox is not a function\n    at tests/e2e-support.ts:413:30",
    )

    described = failure.described()

    assert "src/routes/progress.e2e.ts" in described
    assert "renders at 360px viewport width" in described
    assert "TypeError: locator.boundingBox is not a function" in described
    # only the first line: the stack belongs in the runner's own output
    assert "e2e-support.ts:413" not in described


def test_a_throw_inside_a_test_helper_blames_the_test():
    failure = Failure(
        "src/routes/progress.e2e.ts",
        "renders at 360px viewport width",
        "TypeError: locator.boundingBox is not a function\n    at tests/e2e-support.ts:413:30",
    )

    assert failure_reason.blames_the_test(failure, ["src/routes/progress.e2e.ts"])


def test_a_throw_inside_product_code_does_not_blame_the_test():
    failure = Failure(
        "src/lib/units.spec.ts",
        "converts to kilograms",
        "TypeError: Cannot read properties of undefined (reading 'units')",
        "src/lib/units.ts",
    )

    assert not failure_reason.blames_the_test(failure, ["src/lib/units.spec.ts"])


def test_a_throw_with_no_known_location_does_not_blame_the_test():
    failure = Failure("src/lib/units.spec.ts", "converts", "TypeError: boom")

    assert not failure_reason.blames_the_test(failure, ["src/lib/units.spec.ts"])
