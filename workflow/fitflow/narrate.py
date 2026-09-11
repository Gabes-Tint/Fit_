"""The human-readable run log: same lines to stdout and to a log file.

Each step module calls these to say what it did. Keep every call a plain
sentence with an emoji marking its kind - a human reading only this log must
be able to follow the whole run.
"""

import datetime
import sys
from pathlib import Path

from fitflow import settings

_log_file = None


def start(issue_number: int | str) -> Path:
    """Open <FIT_FLOW_HOME>/logs/issue-<n>/<timestamp>.log and print the banner."""
    global _log_file
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    file_stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_dir = settings.LOGS_DIR / f"issue-{issue_number}"
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"{file_stamp}.log"
    _log_file = path.open("a", encoding="utf-8")
    line(f"🧭 Fit_ flow · block 1: pick and plan · {stamp}")
    return path


def line(text: str) -> None:
    """Print one line and append it to the run's log file."""
    print(text)
    if _log_file is not None:
        _log_file.write(text + "\n")
        _log_file.flush()


def block(lines: list[str]) -> None:
    """A `   │ ` continuation block, e.g. a prompt's full text."""
    for text in lines:
        line(f"   │ {text}")


def fields(pairs: list[tuple[str, str]]) -> None:
    """A `   │ Label: value` block, labels aligned to the widest one."""
    width = max((len(label) for label, _ in pairs), default=0)
    for label, value in pairs:
        line(f"   │ {label + ':':<{width + 1}} {value}")


def raw_json(text: str) -> None:
    """The reply's raw JSON, for audit - file only, never stdout."""
    if _log_file is not None:
        _log_file.write("   │ raw reply JSON:\n")
        for row in text.splitlines():
            _log_file.write(f"   │ {row}\n")
        _log_file.flush()


def close() -> None:
    global _log_file
    if _log_file is not None:
        _log_file.close()
        _log_file = None


def die(text: str) -> None:
    """A failure line, also to stderr so it is visible even without the log."""
    line(text)
    print(text, file=sys.stderr)
