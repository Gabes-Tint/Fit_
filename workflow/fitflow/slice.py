"""The unit of work block 1 hands to block 2: one layer of one story.

test_files and commit are empty until block 1's mechanic has validated the
failing acceptance tests; they then name the exact test files and the
pushed failing-test commit that block 2 must reuse unchanged.
"""

from dataclasses import dataclass, field


@dataclass
class Slice:
    number: int
    layer: str
    title: str
    brief: str
    acceptance: list[str]
    test_kind: str
    test_files: list[str] = field(default_factory=list)
    commit: str = ""
