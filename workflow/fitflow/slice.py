"""The unit of work block 1 hands to block 2: one layer of one story."""

from dataclasses import dataclass


@dataclass
class Slice:
    number: int
    layer: str
    title: str
    brief: str
    acceptance: list[str]
    test_kind: str
