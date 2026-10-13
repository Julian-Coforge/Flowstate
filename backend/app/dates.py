from __future__ import annotations

import re
from datetime import date, timedelta

WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

_MONTH_ALT = "|".join(MONTHS)
_WEEKDAY_ALT = "|".join(WEEKDAYS)

# Prefer final/hand-in wording over mid-project reviews when several "due" lines exist.
_DEADLINE_PRIORITY = re.compile(
    r"\b(final\s+submission|final\s+deadline|hand\s*in|submit|submission|deadline)\b",
    re.I,
)
_START_PRIORITY = re.compile(r"\b(start(?:s|ing)?|begin(?:s|ning)?|kickoff|kick-off)\b", re.I)
_ISO = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")


def upcoming_weekday(today: date, weekday: int, *, force_next: bool = False) -> date:
    """Soonest occurrence of weekday on or after today. If force_next and it is today, jump a week."""
    delta = (weekday - today.weekday()) % 7
    if delta == 0 and force_next:
        delta = 7
    return today + timedelta(days=delta)


def parse_month_day(text: str, today: date) -> date | None:
    patterns = [
        re.compile(
            rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTH_ALT})(?:\s+(\d{{4}}))?\b",
            re.I,
        ),
        re.compile(
            rf"\b({_MONTH_ALT})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{{4}})?\b",
            re.I,
        ),
    ]
    for index, pattern in enumerate(patterns):
        match = pattern.search(text)
        if not match:
            continue
        if index == 0:
            day = int(match.group(1))
            month = MONTHS[match.group(2).lower()]
            year_group = match.group(3)
        else:
            month = MONTHS[match.group(1).lower()]
            day = int(match.group(2))
            year_group = match.group(3)
        year = int(year_group) if year_group else today.year
        try:
            candidate = date(year, month, day)
        except ValueError:
            return None
        if candidate < today and not year_group:
            candidate = date(year + 1, month, day)
        return candidate
    return None


def _window(text: str, start: int, end: int, *, before: int = 56, after: int = 72) -> str:
    return text[max(0, start - before) : min(len(text), end + after)]


def _parse_due_clause(clause: str, today: date) -> date | None:
    """Resolve a 'due …' / 'deadline …' clause, preferring explicit calendar dates."""
    iso = _ISO.search(clause)
    if iso:
        try:
            return date.fromisoformat(iso.group(1))
        except ValueError:
            pass

    month_day = parse_month_day(clause, today)
    if month_day:
        return month_day

    weekday_match = re.search(
        rf"\b(?:(this|next)\s+)?({_WEEKDAY_ALT})\b",
        clause,
        re.I,
    )
    if weekday_match:
        force_next = (weekday_match.group(1) or "").lower() == "next"
        return upcoming_weekday(today, WEEKDAYS[weekday_match.group(2).lower()], force_next=force_next)
    return None


def _pick_deadline(blob: str, today: date) -> tuple[date, str] | None:
    """Find the project deadline. Never treat a kickoff/start ISO as the deadline."""
    lower = blob.lower()
    candidates: list[tuple[int, date, str]] = []

    for match in re.finditer(
        rf"\b(?:due|deadline|hand\s*in|submit(?:ted|ting)?(?:\s+by)?)\b([^.\n]{{0,80}})",
        lower,
    ):
        clause = match.group(0)
        resolved = _parse_due_clause(clause, today)
        if not resolved:
            continue
        # Skip "due …" lines that are clearly about starting work.
        if _START_PRIORITY.search(clause) and not _DEADLINE_PRIORITY.search(clause):
            continue
        priority = 2 if _DEADLINE_PRIORITY.search(_window(lower, match.start(), match.end())) else 1
        # Mid-project reviews are weaker than final submission.
        if re.search(r"\b(mid[- ]?project|design review|feature freeze)\b", _window(lower, match.start(), match.end())):
            priority = 0
        candidates.append((priority, resolved, clause.strip()))

    # ISO dates near final/submission/deadline wording (not near start/kickoff).
    for match in _ISO.finditer(blob):
        try:
            resolved = date.fromisoformat(match.group(1))
        except ValueError:
            continue
        ctx = _window(lower, match.start(), match.end())
        if _START_PRIORITY.search(ctx) and not _DEADLINE_PRIORITY.search(ctx):
            continue
        if _DEADLINE_PRIORITY.search(ctx) or re.search(r"\b(due|by|before)\b", ctx):
            priority = 2 if _DEADLINE_PRIORITY.search(ctx) else 1
            if re.search(r"\b(mid[- ]?project|design review|feature freeze)\b", ctx):
                priority = 0
            candidates.append((priority, resolved, match.group(1)))

    if not candidates:
        return None

    # Highest priority, then latest calendar date (final hand-in beats earlier milestones).
    candidates.sort(key=lambda item: (item[0], item[1]))
    _priority, resolved, label = candidates[-1]
    return resolved, label


def _pick_start(blob: str, today: date) -> tuple[date, str] | None:
    lower = blob.lower()

    start_weekday = re.search(
        rf"\b(?:start(?:s|ing)?|begin(?:s|ning)?|kickoff|kick-off)\s+(?:on\s+)?(?:(this|next)\s+)?({_WEEKDAY_ALT})\b",
        lower,
    )
    if start_weekday:
        force_next = (start_weekday.group(1) or "").lower() == "next"
        resolved = upcoming_weekday(today, WEEKDAYS[start_weekday.group(2)], force_next=force_next)
        return resolved, f"{resolved.strftime('%A')} {resolved.isoformat()}"

    start_chunk = re.search(
        rf"\b(?:start(?:s|ing)?|begin(?:s|ning)?|kickoff|kick-off)\b([^.\n]{{0,64}})",
        lower,
    )
    if start_chunk:
        clause = start_chunk.group(0)
        iso = _ISO.search(clause)
        if iso:
            try:
                return date.fromisoformat(iso.group(1)), iso.group(1)
            except ValueError:
                pass
        month_day = parse_month_day(clause, today)
        if month_day:
            return month_day, month_day.isoformat()

    # ISO near start/kickoff wording.
    for match in _ISO.finditer(blob):
        ctx = _window(lower, match.start(), match.end())
        if not _START_PRIORITY.search(ctx):
            continue
        if _DEADLINE_PRIORITY.search(ctx):
            continue
        try:
            resolved = date.fromisoformat(match.group(1))
        except ValueError:
            continue
        return resolved, match.group(1)

    return None


def resolve_recurrence(idea: str, today: date | None = None, document_text: str | None = None) -> dict | None:
    """Detect repeating habits like 'every Monday' / daily / weekly / monthly."""
    current = today or date.today()
    blob = f"{idea or ''}\n{document_text or ''}".lower()

    if re.search(r"\b(every\s+day|each\s+day|daily)\b", blob):
        return {
            "recurrence": "daily",
            "dueDate": current.isoformat(),
            "label": "every day",
        }

    weekday_match = re.search(rf"\b(?:every|each)\s+({_WEEKDAY_ALT})\b", blob)
    if weekday_match:
        name = weekday_match.group(1).lower()
        due = upcoming_weekday(current, WEEKDAYS[name], force_next=False)
        return {
            "recurrence": "weekly",
            "dueDate": due.isoformat(),
            "weekday": name,
            "label": f"every {name.capitalize()}",
        }

    if re.search(r"\b(every\s+week|each\s+week|weekly)\b", blob):
        return {
            "recurrence": "weekly",
            "dueDate": upcoming_weekday(current, current.weekday(), force_next=True).isoformat(),
            "label": "every week",
        }

    if re.search(r"\b(every\s+month|each\s+month|monthly)\b", blob):
        return {
            "recurrence": "monthly",
            "dueDate": current.isoformat(),
            "label": "every month",
        }

    return None


def resolve_schedule_anchors(idea: str, today: date | None = None, document_text: str | None = None) -> dict:
    """Pull explicit timing from the user idea (preferred) and document."""
    current = today or date.today()
    # Idea first so a short user correction can override a long brief.
    blob = f"{idea or ''}\n{document_text or ''}"
    anchors: dict[str, str] = {
        "today": current.isoformat(),
        "todayWeekday": current.strftime("%A"),
    }

    deadline = _pick_deadline(blob, current)
    if deadline:
        resolved, label = deadline
        anchors["deadline"] = resolved.isoformat()
        anchors["deadlineLabel"] = label if any(ch.isdigit() for ch in label) else f"{resolved.strftime('%A')} {resolved.isoformat()}"

    start = _pick_start(blob, current)
    if start:
        resolved, label = start
        anchors["start"] = resolved.isoformat()
        anchors["startLabel"] = label

    # If start landed on/after the deadline, drop start so work can still spread before hand-in.
    if anchors.get("start") and anchors.get("deadline"):
        if anchors["start"] >= anchors["deadline"]:
            anchors.pop("start", None)
            anchors.pop("startLabel", None)

    recurrence = resolve_recurrence(idea, current, document_text)
    if recurrence:
        anchors["recurrence"] = recurrence["recurrence"]
        anchors["recurrenceDueDate"] = recurrence["dueDate"]
        anchors["recurrenceLabel"] = recurrence["label"]
        if recurrence.get("weekday"):
            anchors["recurrenceWeekday"] = recurrence["weekday"]
        # Habit-style prompts: first occurrence is the start, not a one-off deadline.
        if "deadline" not in anchors and "start" not in anchors:
            anchors["start"] = recurrence["dueDate"]
            anchors["startLabel"] = recurrence["label"]

    return anchors


def apply_recurrence_anchors(
    plan_nodes: list[dict],
    plan_todos: list[dict],
    anchors: dict,
    idea: str,
) -> tuple[list[dict], list[dict]]:
    """Ensure repeating habits produce a todo with the right recurrence + first due date."""
    recurrence = anchors.get("recurrence")
    due = anchors.get("recurrenceDueDate")
    if not recurrence or recurrence == "none" or not due:
        return plan_nodes, plan_todos

    nodes = [dict(node) for node in plan_nodes]
    todos = [dict(todo) for todo in plan_todos]
    label = anchors.get("recurrenceLabel") or recurrence

    for node in nodes:
        if not node.get("dueDate"):
            node["dueDate"] = due

    updated = False
    for todo in todos:
        text = (todo.get("text") or "").lower()
        if todo.get("recurrence") in {None, "none"} and any(
            word in text for word in ("every", "weekly", "daily", "monthly", "swim", "habit", "remind")
        ):
            todo["recurrence"] = recurrence
            todo["dueDate"] = due
            updated = True
        elif todo.get("recurrence") == recurrence:
            todo["dueDate"] = due
            updated = True

    if not any(todo.get("recurrence") == recurrence for todo in todos):
        summary = re.sub(r"^\s*(create a plan to|plan to|make a plan to)\s+", "", (idea or "").strip(), flags=re.I)
        summary = summary[:120].rstrip(" .") or label
        # Capitalize first letter for a tidy task title.
        summary = summary[:1].upper() + summary[1:] if summary else label
        todos.insert(
            0,
            {
                "text": summary,
                "nodeKey": nodes[0]["key"] if nodes else None,
                "dueDate": due,
                "recurrence": recurrence,
            },
        )
        updated = True

    if updated or todos:
        # Keep primary habit todos pinned to the cadence date.
        for todo in todos:
            if todo.get("recurrence") == recurrence:
                todo["dueDate"] = due

    return nodes, todos


def _parse_iso(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def apply_schedule_anchors(
    plan_nodes: list[dict],
    plan_todos: list[dict],
    anchors: dict,
) -> tuple[list[dict], list[dict]]:
    """Force plans to respect a resolved deadline/start after the model responds."""
    deadline = _parse_iso(anchors.get("deadline"))
    start = _parse_iso(anchors.get("start"))
    today = _parse_iso(anchors.get("today")) or date.today()
    if not deadline and not start:
        return plan_nodes, plan_todos

    nodes = [dict(node) for node in plan_nodes]
    todos = [dict(todo) for todo in plan_todos]

    if deadline:
        submit_index = None
        for index, node in enumerate(nodes):
            title = (node.get("title") or "").lower()
            key = (node.get("key") or "").lower()
            blob = f"{title} {key}"
            if "freeze" in blob:
                continue
            if any(word in blob for word in ("submit", "submission", "hand in")):
                submit_index = index
                break
            if "deadline" in blob and "mid" not in blob:
                submit_index = index
                break
        if submit_index is None:
            for index, node in enumerate(nodes):
                title = (node.get("title") or "").lower()
                if re.search(r"\bfinal\b", title) and any(word in title for word in ("submit", "submission", "deliver", "hand")):
                    submit_index = index
                    break
        if submit_index is None and nodes:
            submit_index = len(nodes) - 1

        work_start = start or (today + timedelta(days=1))
        if work_start > deadline:
            work_start = today if today <= deadline else deadline
        span_days = max((deadline - work_start).days, 0)

        if nodes:
            usable = max(len(nodes) - 1, 1)
            for index, node in enumerate(nodes):
                if index == submit_index:
                    node["dueDate"] = deadline.isoformat()
                    continue
                offset = round((index / usable) * span_days) if span_days else 0
                # Keep non-final steps on or before the day before deadline when possible.
                if span_days > 0 and index < usable:
                    offset = min(offset, span_days - 1)
                node["dueDate"] = (work_start + timedelta(days=offset)).isoformat()
            if submit_index is not None:
                nodes[submit_index]["dueDate"] = deadline.isoformat()

        for todo in todos:
            due = _parse_iso(todo.get("dueDate"))
            text = (todo.get("text") or "").lower()
            if any(word in text for word in ("submit", "submission", "hand in", "final")) or (due and due > deadline):
                todo["dueDate"] = deadline.isoformat()

    elif start:
        for node in nodes:
            due = _parse_iso(node.get("dueDate"))
            title = (node.get("title") or "").lower()
            if due is None or any(word in title for word in ("start", "flight", "depart", "kickoff", "begin")):
                if due is None or due < start:
                    node["dueDate"] = start.isoformat()

    return nodes, todos


def format_anchor_block(anchors: dict) -> str:
    if not anchors.get("deadline") and not anchors.get("start") and not anchors.get("recurrence"):
        return ""
    lines = [
        "Hard date anchors (resolved by the server — you MUST use these exact ISO dates):",
        f"- Today: {anchors['today']} ({anchors.get('todayWeekday', '')})",
    ]
    if anchors.get("deadline"):
        lines.append(
            f"- Deadline / due date: {anchors['deadline']} ({anchors.get('deadlineLabel', anchors['deadline'])})"
        )
        lines.append("- Every node dueDate must be on or before the deadline.")
        lines.append("- The submission / final step dueDate MUST equal the deadline exactly.")
        lines.append("- Spread earlier work between the start date (or tomorrow) and the day before the deadline.")
        lines.append("- Do not schedule anything after the deadline.")
        lines.append("- Do not use kickoff/start dates as the submission deadline.")
    if anchors.get("start") and not anchors.get("recurrence"):
        lines.append(f"- Start date: {anchors['start']} ({anchors.get('startLabel', anchors['start'])})")
        lines.append("- Early setup / kickoff steps should land on or shortly after the start date.")
    if anchors.get("recurrence"):
        lines.append(
            f"- Recurring habit: {anchors.get('recurrenceLabel', anchors['recurrence'])} "
            f"(recurrence={anchors['recurrence']}, first dueDate={anchors.get('recurrenceDueDate')})"
        )
        lines.append(
            f"- Create at least one todo with recurrence \"{anchors['recurrence']}\" "
            f"and dueDate \"{anchors.get('recurrenceDueDate')}\" (the next occurrence)."
        )
        lines.append("- Do NOT invent separate one-off todos for each future week/day; one repeating todo is enough.")
        if anchors.get("recurrenceWeekday"):
            lines.append(
                f"- The first dueDate must fall on a {anchors['recurrenceWeekday'].capitalize()}."
            )
    return "\n".join(lines) + "\n"
