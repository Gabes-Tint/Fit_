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
    # The exported names this slice changes that files under the UI areas
    # call. Non-empty only on a domain slice, and what makes it additive:
    # its brief carries the additive clause, and the ui slice of the same
    # story runs after it and adopts the new API.
    ui_called_exports: list[str] = field(default_factory=list)
    # How many type and type-aware lint errors each acceptance file carries
    # because the API it calls does not exist yet - block 1 accepted those,
    # and block 3 reads this to know it did.
    tests_type_debt: dict[str, int] = field(default_factory=dict)
    # Which role finally wrote these tests, and how many rungs block 1 had
    # to climb to get them: "mechanic"/0 unless block 1's own ladder
    # escalated. Block 3's repair of a rejected test set starts from this
    # role rather than from the mechanic, because this is the role that
    # knows what the tests mean.
    tests_role: str = "mechanic"
    tests_revision: int = 0
