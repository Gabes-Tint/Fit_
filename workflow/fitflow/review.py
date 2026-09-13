"""Block 4's review gate: the mechanical predicate, the reviewer reply's
contract, and findings routing.

The reviewer proposes a verdict; this module and the driver own the
decision. `is_mechanical` recomputes every slice's selection row from its
retained signals - the same precedence table as block 2, so delivery cannot
re-judge what delegation decided. `validate_reply` is strict about shape,
categories and diff reality: a finding that does not cite a file in the
actual integration diff is a contract failure, never a review comment.
"""

from dataclasses import dataclass

from fitflow import layers, selection
from fitflow.runstate import RunRecord

CATEGORIES = (
    "correctness",
    "security",
    "data-loss",
    "concurrency",
    "contract",
    "regression-coverage",
    "threshold-policy",
)

VERDICTS = ("merge", "fix")
_FINDING_KEYS = ("file", "line", "category", "required_fix")
_MAX_REVIEW_ROUNDS = 2


class ReviewError(ValueError):
    """A malformed reviewer reply: retried in the reviewer's bounded
    corrective loop, never graded into a verdict."""


class ReviewContractError(Exception):
    """The reviewer broke its contract: a phantom file, a write to the
    integration worktree, a verdict its own findings contradict. Stops the
    run immediately."""


@dataclass(frozen=True)
class Finding:
    file: str
    line: int
    category: str
    required_fix: str


def is_mechanical(record: RunRecord) -> bool:
    """True when every slice's final assignment signals still select row 4:
    complete procedure, no technical choice, no sensitive area, no
    uncertainty. Recomputed from the retained signals with block 2's own
    precedence table."""
    for piece in record.ordered():
        signals = selection.validate_signals(piece.assignments[-1]["signals"])
        decision = selection.select_role(signals)
        if decision.row != 4:
            return False
    return True


def max_rounds() -> int:
    return _MAX_REVIEW_ROUNDS


def validate_reply(reply: object, diff_files: list[str]) -> tuple[str, list[Finding]]:
    """Strict driver-side check of the reviewer's reply against the actual
    diff. Returns (verdict, findings); raises ReviewError for a malformed
    reply (the reviewer's corrective loop) and ReviewContractError for a
    reply that breaks the review contract (phantom files)."""
    if not isinstance(reply, dict) or set(reply) != {"verdict", "findings"}:
        raise ReviewError("reply must have exactly the fields verdict and findings")
    verdict = reply["verdict"]
    if verdict not in VERDICTS:
        raise ReviewError(f"verdict must be one of {', '.join(VERDICTS)}; got {verdict!r}")
    raw = reply["findings"]
    if not isinstance(raw, list):
        raise ReviewError("findings must be an array")
    findings = [_validate_finding(entry, index) for index, entry in enumerate(raw)]
    if verdict == "fix" and not findings:
        raise ReviewError("verdict fix requires at least one finding")
    phantom = sorted({finding.file for finding in findings} - set(diff_files))
    if phantom:
        raise ReviewContractError(
            f"review finding cites a file outside the PR diff: {', '.join(phantom)}"
        )
    return verdict, findings


def _validate_finding(entry: object, index: int) -> Finding:
    where = f"findings[{index}]"
    if not isinstance(entry, dict):
        raise ReviewError(f"{where} must be an object")
    _check_finding_keys(entry, where)
    for key in ("file", "category", "required_fix"):
        if not isinstance(entry[key], str) or not entry[key].strip():
            raise ReviewError(f"{where}.{key} must be a non-empty string")
    if entry["category"] not in CATEGORIES:
        raise ReviewError(
            f"{where}.category must be one of {', '.join(CATEGORIES)}; got {entry['category']!r}"
        )
    line = entry["line"]
    if not isinstance(line, int) or isinstance(line, bool) or line < 1:
        raise ReviewError(f"{where}.line must be a positive integer, got {line!r}")
    return Finding(entry["file"], line, entry["category"], entry["required_fix"])


def _check_finding_keys(entry: dict, where: str) -> None:
    missing = sorted(set(_FINDING_KEYS) - set(entry))
    extra = sorted(set(entry) - set(_FINDING_KEYS))
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing {', '.join(missing)}")
        if extra:
            details.append(f"unknown {', '.join(extra)}")
        raise ReviewError(f"{where}: {'; '.join(details)}")


def route_findings(record: RunRecord, findings: list[Finding]) -> list[str]:
    """The layers whose slices must take a fix turn, in domain-then-UI
    order regardless of the findings' own order. A finding no slice of this
    run owns is a contract failure: the domain layer owns every non-UI
    file, the UI layer owns routes and components, and a file outside both
    cannot have come from this run's slices."""
    affected = []
    for piece in record.ordered():
        if any(owns(piece.layer, finding.file) for finding in findings):
            affected.append(piece.layer)
    unrouted = sorted(
        {
            finding.file
            for finding in findings
            if not any(owns(layer, finding.file) for layer in record.slices)
        }
    )
    if unrouted:
        raise ReviewContractError(
            f"review finding belongs to no slice of this run: {', '.join(unrouted)}"
        )
    return affected


def owns(layer: str, file: str) -> bool:
    """True when `file` is inside `layer`'s boundary."""
    return layers.rejects_for_layer(layer, file) is None


def findings_diagnostic(findings: list[Finding]) -> str:
    """The fix turn's diagnostic: the review findings, quoted for the
    implementer the way every other diagnostic is."""
    lines = ["the reviewer rejected the delivery with these findings:"]
    for finding in findings:
        lines.append(f"- {finding.file}:{finding.line} [{finding.category}] {finding.required_fix}")
    return "\n".join(lines)
