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


def upcoming_weekday(today: date, weekday: int, *, force_next: bool = False) -> date:
    """Soonest occurrence of weekday on or after today. If force_next and it is today, jump a week."""
    delta = (weekday - today.weekday()) % 7
    if delta == 0 and force_next:
        delta = 7
    return today + timedelta(days=delta)


def parse_month_day(text: str, today: date) -> date | None:
    patterns = [
        re.compile(
            r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(" + "|".join(MONTHS) + r")(?:\s+(\d{4}))?\b",
            re.I,
        ),
        re.compile(
            r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{4})?\b",
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


def resolve_schedule_anchors(idea: str, today: date | None = None, document_text: str | None = None) -> dict:
    """Pull explicit timing from the user idea (preferred) and document."""
    current = today or date.today()
    blob = f"{idea or ''}\n{document_text or ''}"
    lower = blob.lower()
    anchors: dict[str, str] = {
        "today": current.isoformat(),
        "todayWeekday": current.strftime("%A"),
    }

    iso = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", blob)
    if iso:
        anchors["deadline"] = iso.group(1)
        anchors["deadlineLabel"] = iso.group(1)

    weekday_alt = "|".join(WEEKDAYS)
    due_weekday = re.search(
        rf"\b(?:due|deadline|hand\s*in)\s+(?:on\s+)?(?:(this|next)\s+)?({weekday_alt})\b",
        lower,
    ) or re.search(
        rf"\b(?:by|before)\s+(?:this\s+|next\s+)?({weekday_alt})\b",
        lower,
    )
    if due_weekday and "deadline" not in anchors:
        if due_weekday.lastindex == 2:
            force_next = due_weekday.group(1) == "next"
            weekday = WEEKDAYS[due_weekday.group(2)]
        else:
            # by/before Friday
            force_next = "next " in due_weekday.group(0)
            weekday = WEEKDAYS[due_weekday.group(1)]
        resolved = upcoming_weekday(current, weekday, force_next=force_next)
        anchors["deadline"] = resolved.isoformat()
        anchors["deadlineLabel"] = f"{resolved.strftime('%A')} {resolved.isoformat()}"

    if "deadline" not in anchors:
        due_chunk = re.search(r"\b(?:due|deadline|by|before)\b([^.\n]{0,48})", lower)
        chunk = due_chunk.group(0) if due_chunk else ""
        month_day = parse_month_day(chunk, current) if chunk else None
        if month_day:
            anchors["deadline"] = month_day.isoformat()
            anchors["deadlineLabel"] = month_day.isoformat()

    start_weekday = re.search(
        rf"\b(?:start(?:ing)?|begin(?:ning)?)\s+(?:on\s+)?(?:(this|next)\s+)?({weekday_alt})\b",
        lower,
    )
    if start_weekday:
        force_next = start_weekday.group(1) == "next"
        weekday = WEEKDAYS[start_weekday.group(2)]
        resolved = upcoming_weekday(current, weekday, force_next=force_next)
        anchors["start"] = resolved.isoformat()
        anchors["startLabel"] = f"{resolved.strftime('%A')} {resolved.isoformat()}"

    if "start" not in anchors:
        start_chunk = re.search(r"\b(?:start(?:ing)?|begin(?:ning)?)\b([^.\n]{0,48})", lower)
        if start_chunk:
            month_day = parse_month_day(start_chunk.group(0), current)
            if month_day:
                anchors["start"] = month_day.isoformat()
                anchors["startLabel"] = month_day.isoformat()

    return anchors


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
            if any(word in title or word in key for word in ("submit", "submission", "hand in", "deadline")):
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
                    offset = min(offset, span_days - 1 if span_days > 0 else 0)
                node["dueDate"] = (work_start + timedelta(days=offset)).isoformat()
            if submit_index is not None:
                nodes[submit_index]["dueDate"] = deadline.isoformat()

        for todo in todos:
            due = _parse_iso(todo.get("dueDate"))
            text = (todo.get("text") or "").lower()
            if any(word in text for word in ("submit", "submission", "hand in")) or (due and due > deadline):
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
    if not anchors.get("deadline") and not anchors.get("start"):
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
        lines.append("- Spread earlier work between tomorrow (or start) and the day before the deadline.")
        lines.append("- Do not schedule anything after the deadline.")
    if anchors.get("start"):
        lines.append(f"- Start date: {anchors['start']} ({anchors.get('startLabel', anchors['start'])})")
        lines.append("- The main start / event step dueDate MUST equal the start date.")
    return "\n".join(lines) + "\n"
