from pathlib import Path

import pytest

from fitflow import acceptance


def test_parse_json_accepts_runner_noise_before_report():
    report = acceptance._parse_json('runner setup output\n{"suites": []}\n')

    assert report == {"suites": []}


def test_local_asserted_stand_in_without_product_import_is_rejected(tmp_path: Path):
    spec = tmp_path / "feature.spec.ts"
    spec.write_text(
        "import { expect } from 'vitest';\n"
        "const missingFeature = (value: string) => value;\n"
        "expect(missingFeature('x')).toBe('y');\n"
    )

    assert "local stand-in callable missingFeature" in acceptance.rejects_local_stand_in(spec)


def test_test_helper_is_allowed_when_product_boundary_is_imported(tmp_path: Path):
    spec = tmp_path / "feature.spec.ts"
    spec.write_text(
        "import { expect } from 'vitest';\n"
        "import { feature } from './feature';\n"
        "const expected = (value: string) => value.trim();\n"
        "expect(feature(' x ')).toBe(expected(' x '));\n"
    )

    assert acceptance.rejects_local_stand_in(spec) is None


@pytest.mark.parametrize(
    ("status", "is_failure"),
    [
        ("passed", False),
        ("skipped", False),
        ("failed", True),
        ("timedOut", True),
        ("interrupted", True),
        ("", False),
        (None, False),
    ],
)
def test_every_playwright_status_but_passed_and_skipped_counts_as_a_failure(status, is_failure):
    """A `toBeVisible` waiting for UI that does not exist yet times out
    instead of failing an assertion; reading only `failed` called that
    "passed with no implementation" and rejected a correct test."""
    assert acceptance._is_playwright_failure(status) is is_failure


@pytest.mark.parametrize(
    ("status", "is_failure"),
    [
        ("passed", False),
        ("pending", False),
        ("skipped", False),
        ("todo", False),
        ("failed", True),
        ("", False),
        (None, False),
    ],
)
def test_every_vitest_status_but_passed_and_skipped_counts_as_a_failure(status, is_failure):
    assert acceptance._is_vitest_failure(status) is is_failure


# A playwright file shaped like the one #337 run 6 stopped on: a describe
# block whose own title reads like a test, a nested describe inside it, and
# tests in all three quotes - one of them carrying the other quote inside
# its title.
_DESCRIBED = """
import { expect, test } from '@playwright/test';

test.describe('ranking "green apple" shows a fruit as the first result', () => {
	test.describe.serial('against the real catalog', () => {
		test('the fruit is the first row', async ({ page }) => {});
		it.skip("the candy is not", async () => {});
	});
	test.only(`a row says "no brand" when it has none`, async ({ page }) => {});
});

describe('rows', () => {
	it('carries its brand', () => {});
	test.fixme('and says where it came from', () => {});
});
"""


def test_describe_blocks_are_not_tests():
    """#337 run 6. `(?:\\.\\w+)*` matched `.describe`, so the title of a
    describe block came back as a test; a repair that renamed one was
    refused for deleting a test nobody had written."""
    titles = acceptance.test_titles("src/routes/rows.e2e.ts", _DESCRIBED)

    assert titles == [
        "the fruit is the first row",
        "the candy is not",
        'a row says "no brand" when it has none',
        "carries its brand",
        "and says where it came from",
    ]


def test_a_python_test_file_reports_one_name_per_def():
    source = "def test_one():\n    pass\n\n\ndef test_two():\n    pass\n"

    assert acceptance.test_titles("workflow/tests/test_rows.py", source) == [
        "test_one",
        "test_two",
    ]
