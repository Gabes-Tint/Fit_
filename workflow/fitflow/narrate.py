"""The human-readable run log: same lines to stdout and to a log file.

Each step module calls these to say what it did. Keep every call a plain
sentence with an emoji marking its kind - a human reading only this log must
be able to follow the whole run.

The log file lives under `logs/issue-<n>/` - but the issue is not known
until it is picked (an auto-pick has to list and hold candidates first), so
early lines are buffered here and flushed into the file the moment
`open_for_issue()` names the story.
"""

import datetime
import sys
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from fitflow import settings

_buffer: list[str] = []
_log_file = None
_lock = threading.RLock()


@contextmanager
def grouped() -> Iterator[None]:
    """Keep a multi-line narration block together across worker threads."""
    with _lock:
        yield


def begin() -> None:
    """Start a run: reset state and print the banner."""
    global _buffer, _log_file
    _buffer = []
    _log_file = None
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    line(f"🧭 Fit_ flow · blocks 1-4: plan, delegate, implement, deliver · {stamp}")


def open_for_issue(issue_number: int) -> None:
    """Open <FIT_FLOW_HOME>/logs/issue-<n>/<timestamp>.log, flushing every
    line buffered before the story was known."""
    global _log_file
    if _log_file is not None:
        return
    file_stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_dir = settings.LOGS_DIR / f"issue-{issue_number}"
    log_dir.mkdir(parents=True, exist_ok=True)
    _log_file = (log_dir / f"{file_stamp}.log").open("a", encoding="utf-8")
    for buffered in _buffer:
        _log_file.write(buffered + "\n")
    _log_file.flush()


def line(text: str) -> None:
    """Print one line and append it to the run's log file, or buffer it if
    the story is not known yet."""
    with _lock:
        print(text)
        if _log_file is not None:
            _log_file.write(text + "\n")
            _log_file.flush()
        else:
            _buffer.append(text)


def block(lines: list[str]) -> None:
    """A `   │ ` continuation block, e.g. a prompt's full text."""
    with _lock:
        for text in lines:
            line(f"   │ {text}")


def fields(pairs: list[tuple[str, str]]) -> None:
    """A `   │ Label: value` block, labels aligned to the widest one."""
    with _lock:
        width = max((len(label) for label, _ in pairs), default=0)
        for label, value in pairs:
            line(f"   │ {label + ':':<{width + 1}} {value}")


def comment_posted(number: int, body: str) -> None:
    """Every GitHub write worth reading back: the comment's own body,
    indented under the line announcing it."""
    with _lock:
        line(f"✏️  Comment on #{number}:")
        block(body.splitlines())


def raw_json(text: str) -> None:
    """The reply's raw JSON, for audit - file only, never stdout."""
    with _lock:
        if _log_file is not None:
            _log_file.write("   │ raw reply JSON:\n")
            for row in text.splitlines():
                _log_file.write(f"   │ {row}\n")
            _log_file.flush()
        else:
            _buffer.append("   │ raw reply JSON:")
            _buffer.extend(f"   │ {row}" for row in text.splitlines())


def close() -> None:
    global _log_file
    if _log_file is not None:
        _log_file.close()
        _log_file = None


def die(text: str) -> None:
    """A failure line, also to stderr so it is visible even without the log."""
    line(text)
    print(text, file=sys.stderr)
