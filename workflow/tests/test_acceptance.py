from pathlib import Path

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
