"""Unit tests for the lane readers: which type and lint errors an
acceptance test is allowed to carry before the API it calls exists, and
whether the driver understood the lane's output well enough to say."""

import pytest

from fitflow import lanes
from fitflow.lanes import LaneError

# The five type-aware rules an unresolved import propagates into, and the
# ones that stay the mechanic's to fix while she still owns the file.
TOLERATED_RULES = [
    "@typescript-eslint/no-unsafe-call",
    "@typescript-eslint/no-unsafe-member-access",
    "@typescript-eslint/no-unsafe-assignment",
    "@typescript-eslint/no-unsafe-argument",
    "@typescript-eslint/no-unsafe-return",
]
REJECTED_RULES = [
    "no-console",
    "@typescript-eslint/no-explicit-any",
    "@typescript-eslint/no-unused-vars",
    "prettier/prettier",
    "import/no-duplicates",
    "",
]


@pytest.mark.parametrize("rule", TOLERATED_RULES)
def test_the_any_propagation_rules_are_the_missing_api_talking(rule):
    assert lanes.tolerated_lint_error(LaneError("src/lib/a.spec.ts", rule, "Unsafe call.")) is True


@pytest.mark.parametrize("rule", REJECTED_RULES)
def test_every_other_lint_rule_stays_the_mechanics_to_fix(rule):
    assert lanes.tolerated_lint_error(LaneError("src/lib/a.spec.ts", rule, "whatever")) is False


TOLERATED_TYPE_ERRORS = [
    ("TS2339", "Property 'toggleSet' does not exist on type 'WorkoutStore'."),
    ("TS2554", "Expected 1 arguments, but got 2."),
    ("TS2305", "Module './workout' has no exported member 'nextUndoneSet'."),
    ("TS2307", "Cannot find module './workout' or its corresponding type declarations."),
    ("TS2307", "Cannot find module '$lib/state/tend.svelte'."),
    # the same diagnostics as svelte-check prints them, with no code at all
    ("", "Property 'toggleSet' does not exist on type 'WorkoutStore'."),
    ("", "Expected 1 arguments, but got 2."),
    ("", "Argument of type 'number' is not assignable to parameter of type 'Locator'."),
]
REJECTED_TYPE_ERRORS = [
    ("TS2322", "Type 'string' is not assignable to type 'number'."),
    ("TS1005", "',' expected."),
    ("TS2304", "Cannot find name 'toggleSets'."),
    # a package that is not there is a broken checkout, not a missing API
    ("TS2307", "Cannot find module 'vitest' or its corresponding type declarations."),
    ("TS2307", "Cannot find module '@playwright/test'."),
    ("", "Type 'string' is not assignable to type 'number'."),
]


@pytest.mark.parametrize(("code", "message"), TOLERATED_TYPE_ERRORS)
def test_a_type_error_the_implementation_answers_is_the_missing_api_talking(code, message):
    assert lanes.tolerated_type_error(LaneError("src/lib/a.spec.ts", code, message)) is True


@pytest.mark.parametrize(("code", "message"), REJECTED_TYPE_ERRORS)
def test_a_type_error_no_implementation_answers_stays_a_rejection(code, message):
    assert lanes.tolerated_type_error(LaneError("src/lib/a.spec.ts", code, message)) is False


ESLINT_REPORT = """
src/routes/live.e2e.ts
  180:16  error  Unsafe call of an `any` typed value.  @typescript-eslint/no-unsafe-call
  180:21  error  Unsafe member access .getByRole on an `any` value.  \
@typescript-eslint/no-unsafe-member-access

src/lib/probe.spec.ts
  3:1  error  Unexpected console statement.  no-console

✖ 3 problems (3 errors, 0 warnings)
"""


def test_the_eslint_report_reads_as_one_problem_per_line_under_its_own_file():
    reading = lanes.lint_errors(ESLINT_REPORT)

    assert reading.complete is True
    assert [(error.file, error.rule) for error in reading.errors] == [
        ("src/routes/live.e2e.ts", "@typescript-eslint/no-unsafe-call"),
        ("src/routes/live.e2e.ts", "@typescript-eslint/no-unsafe-member-access"),
        ("src/lib/probe.spec.ts", "no-console"),
    ]


def test_a_lint_problem_with_no_rule_id_leaves_the_reading_incomplete():
    """A parsing error carries no rule, so nothing may be concluded about
    the rest of the report either."""
    reading = lanes.lint_errors(
        "src/lib/probe.spec.ts\n  1:1  error  Parsing error: Unexpected token\n"
    )

    assert reading.complete is False


def test_a_lint_report_that_counts_more_problems_than_were_read_is_incomplete():
    reading = lanes.lint_errors(
        "src/lib/probe.spec.ts\n"
        "  3:1  error  Unexpected console statement.  no-console\n"
        "✖ 9 problems (9 errors, 0 warnings)\n"
    )

    assert reading.complete is False


SVELTE_CHECK_MACHINE = """
1789326030386 START "/worktree/story-423-domain"
1789326030396 ERROR "src/lib/tend.svelte.spec.ts" 1485:22 "Expected 1 arguments, but got 2."
1789326030396 ERROR "src/lib/tend.svelte.spec.ts" 1493:25 "Expected 1 arguments, but got 2."
1789326030396 COMPLETED 1423 FILES 2 ERRORS 0 WARNINGS 1 FILES_WITH_PROBLEMS
"""

SVELTE_CHECK_HUMAN = """
src/routes/typed.e2e.ts:12:30
Error: Argument of type 'number' is not assignable to parameter of type 'Locator'. (ts)
svelte-check found 1 error and 0 warnings
"""

TSC_REPORT = """
src/lib/tend.svelte.spec.ts(1485,22): error TS2554: Expected 1 arguments, but got 2.
"""


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        (SVELTE_CHECK_MACHINE, [("src/lib/tend.svelte.spec.ts", "")] * 2),
        (SVELTE_CHECK_HUMAN, [("src/routes/typed.e2e.ts", "")]),
        (TSC_REPORT, [("src/lib/tend.svelte.spec.ts", "TS2554")]),
    ],
)
def test_the_type_lane_reads_in_each_shape_it_prints(output, expected):
    reading = lanes.type_errors(output)

    assert reading.complete is True
    assert [(error.file, error.rule) for error in reading.errors] == expected


def test_output_the_reader_cannot_place_is_never_a_basis_for_tolerating_anything():
    assert lanes.type_errors('error: script "check" exited with code 1').complete is False
    assert lanes.type_errors("").complete is False
    assert lanes.lint_errors("eslint runner crashed").complete is False
