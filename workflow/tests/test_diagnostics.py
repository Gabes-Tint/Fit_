"""What "the same diagnostic" means: the substance, not the parts that
move on their own between two runs of the same failure."""

from fitflow.diagnostics import normalize, same_diagnostic


def test_the_same_text_twice_is_the_same_diagnostic() -> None:
    diagnostic = "TESTS_NOT_PUSHED: non-test file changed on story-406-domain: workflow/x.py"

    assert same_diagnostic(diagnostic, diagnostic)


def test_a_diagnostic_differing_only_in_a_sha_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        "story-406-domain: local HEAD 3f9a1c2b7d4e is not pushed",
        "story-406-domain: local HEAD 8c41ba09fe37 is not pushed",
    )


def test_a_diagnostic_differing_only_in_a_duration_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        "verify:changed failed: test:unit:server (12.4s)",
        "verify:changed failed: test:unit:server (9.81s)",
    )


def test_a_diagnostic_differing_only_in_a_timestamp_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        "gh failed at 2026-09-13T09:00:12Z: try again",
        "gh failed at 2026-09-13T11:42:07Z: try again",
    )


def test_a_diagnostic_differing_only_in_the_worktree_path_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        "lint failed in /home/gabriel/git_projects/fit_/.claude/worktrees/story-406-domain/a.ts",
        "lint failed in /srv/ci/checkout/.claude/worktrees/story-406-ui/a.ts",
    )


def test_a_diagnostic_differing_only_in_svelte_checks_epoch_stamps_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        '1789348161683 ERROR "SessionExercise.svelte" 35:8 "Expected 2 arguments, but got 1."',
        '1789348914909 ERROR "SessionExercise.svelte" 35:8 "Expected 2 arguments, but got 1."',
    )


def test_a_diagnostic_differing_only_in_a_vitest_duration_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        "Duration  25.84s (transform 0ms, setup 0ms, import 15.42s)",
        "Duration  24.01s (transform 0ms, setup 0ms, import 15.93s)",
    )


def test_a_diagnostic_differing_only_in_the_time_a_run_started_is_the_same_diagnostic() -> None:
    assert same_diagnostic("Start at  21:09:33", "Start at  21:22:06")


def test_a_diagnostic_differing_only_in_the_cspell_cache_count_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        "CSpell: Files checked: 749, Issues found: 2 in 1 file.",
        "CSpell: Files checked: 749 (748 from cache), Issues found: 2 in 1 file.",
    )


def test_a_cspell_run_that_found_more_issues_is_a_different_diagnostic() -> None:
    assert not same_diagnostic(
        "CSpell: Files checked: 749 (748 from cache), Issues found: 2 in 1 file.",
        "CSpell: Files checked: 749 (748 from cache), Issues found: 3 in 2 files.",
    )


def test_a_diagnostic_naming_a_different_line_of_the_same_file_is_a_different_diagnostic() -> None:
    assert not same_diagnostic(
        '1789348161683 ERROR "SessionExercise.svelte" 35:8 "Expected 2 arguments, but got 1."',
        '1789348161683 ERROR "SessionExercise.svelte" 106:13 "Expected 4 arguments, but got 3."',
    )


def test_a_diagnostic_naming_a_different_file_is_a_different_diagnostic() -> None:
    assert not same_diagnostic(
        "non-test file changed on story-406-domain: workflow/tests/test_agents_retries.py",
        "non-test file changed on story-406-domain: workflow/tests/test_github_retries.py",
    )


def test_a_diagnostic_naming_a_different_failing_test_is_a_different_diagnostic() -> None:
    assert not same_diagnostic(
        "vitest src/lib/a.spec.ts still fails, the implementation is not done yet",
        "vitest src/lib/b.spec.ts still fails, the implementation is not done yet",
    )


def test_a_diagnostic_differing_in_a_count_is_a_different_diagnostic() -> None:
    assert not same_diagnostic("3 tests still fail", "2 tests still fail")


def test_an_empty_diagnostic_repeats_nothing() -> None:
    assert not same_diagnostic("", "")
    assert not same_diagnostic("", "vitest a.spec.ts still fails")
    assert not same_diagnostic("vitest a.spec.ts still fails", "   ")


def test_normalizing_leaves_ordinary_words_and_numbers_alone() -> None:
    assert normalize("the defaced facade of story-1048576 decayed") == (
        "the defaced facade of story-1048576 decayed"
    )


def test_a_diagnostic_differing_only_in_whitespace_is_the_same_diagnostic() -> None:
    assert same_diagnostic(
        "vitest a.spec.ts still fails:\n  expected true\n",
        "vitest a.spec.ts still fails: expected true",
    )
