"""Turn raw GitHub comments and timeline events into planner evidence.

Fetching stays in github.py. This module is deliberately pure: it filters
known duplicate/administrative timeline noise, normalizes useful provenance,
and orders the result without asking an agent to summarize it.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ContextItem:
    occurred_at: str
    event_type: str
    author: str
    content: str
    source_order: int


_IGNORED_EVENTS = {
    "commented",  # fetched from the comments endpoint with the full body
    "mentioned",
    "subscribed",
    "unsubscribed",
}
_MILESTONE_EVENTS = {"milestone" + "d", "de" + "milestone" + "d"}


def prepare(comments: list[dict], events: list[dict]) -> str:
    items = [_comment_item(comment, index) for index, comment in enumerate(comments)]
    offset = len(items)
    items.extend(
        item
        for index, event in enumerate(events, start=offset)
        if (item := _event_item(event, index)) is not None
    )
    items.sort(key=lambda item: (item.occurred_at, item.source_order))
    if not items:
        return "(no comments or important timeline events)"
    return "\n".join(
        f"- {item.occurred_at} | {item.event_type} | {item.author} | {item.content}"
        for item in items
    )


def _comment_item(comment: dict, source_order: int) -> ContextItem:
    return ContextItem(
        occurred_at=_timestamp(comment),
        event_type="comment",
        author=_login(comment.get("user")),
        content=_one_line(comment.get("body")) or "(empty comment)",
        source_order=source_order,
    )


def _event_item(event: dict, source_order: int) -> ContextItem | None:
    event_type = str(event.get("event") or "unknown")
    if event_type in _IGNORED_EVENTS:
        return None
    return ContextItem(
        occurred_at=_timestamp(event),
        event_type=event_type,
        author=_login(event.get("actor") or event.get("user")),
        content=_event_content(event),
        source_order=source_order,
    )


def _event_content(event: dict) -> str:
    event_type = event.get("event")
    if event_type in {"labeled", "unlabeled"}:
        return f"label: {_nested(event, 'label', 'name')}"
    if event_type in {"assigned", "unassigned"}:
        return f"assignee: {_login(event.get('assignee'))}"
    if event_type == "renamed":
        return f"{_nested(event, 'rename', 'from')} -> {_nested(event, 'rename', 'to')}"
    if event_type in _MILESTONE_EVENTS:
        return f"milestone: {_nested(event, 'milestone', 'title')}"
    return _reference_content(event)


def _reference_content(event: dict) -> str:
    event_type = event.get("event")
    if event_type in {"committed", "referenced"}:
        return str(event.get("commit_id") or event.get("sha") or _reference(event))
    if event_type == "cross-referenced":
        source = event.get("source") or {}
        issue = source.get("issue") or {}
        kind = "pull request" if issue.get("pull_request") else "issue"
        number = issue.get("number", "?")
        title = _one_line(issue.get("title"))
        url = issue.get("html_url") or ""
        return f"{kind} #{number}: {title} {url}".strip()
    if event_type == "reviewed":
        state = event.get("state") or "reviewed"
        body = _one_line(event.get("body"))
        reference = _reference(event)
        return " | ".join(part for part in (str(state), body, reference) if part)
    return _reference(event)


def _reference(payload: dict) -> str:
    for key in ("html_url", "commit_url", "url", "node_id"):
        if payload.get(key):
            return str(payload[key])
    return "(no additional detail)"


def _timestamp(payload: dict) -> str:
    return str(payload.get("created_at") or payload.get("submitted_at") or "unknown-time")


def _login(user: dict | None) -> str:
    return str((user or {}).get("login") or "unknown-author")


def _nested(payload: dict, outer: str, inner: str) -> str:
    return str((payload.get(outer) or {}).get(inner) or "unknown")


def _one_line(value: object) -> str:
    return " ".join(str(value or "").split())
