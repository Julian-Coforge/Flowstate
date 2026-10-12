from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Iterable


def progress(nodes: Iterable[dict | object]) -> dict:
    rows = list(nodes)
    total = len(rows)
    done = 0
    for node in rows:
        status = node["status"] if isinstance(node, dict) else node.status
        if status == "done":
            done += 1
    percent = 0 if total == 0 else round((done / total) * 100)
    return {"done": done, "total": total, "percent": percent}


def can_link(source_id: str, target_id: str, existing: Iterable[tuple[str, str]], node_ids: set[str]):
    if source_id not in node_ids or target_id not in node_ids:
        return {"ok": False, "error": "Both steps must be in this project"}
    if source_id == target_id:
        return {"ok": False, "error": "A step can't link to itself"}
    for source, target in existing:
        if source == source_id and target == target_id:
            return {"ok": False, "error": "Those steps are already linked"}
    return {"ok": True}


def today_iso(value: date | None = None) -> str:
    current = value or date.today()
    return current.isoformat()


def add_days(iso: str, days: int) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return (date(year, month, day) + timedelta(days=days)).isoformat()


def add_months(iso: str, months: int) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    month_index = month - 1 + months
    year += month_index // 12
    month = month_index % 12 + 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last)).isoformat()


def next_occurrence(due: str | None, recurrence: str, today: str | None = None) -> str | None:
    if recurrence in ("", "none"):
        return None
    base = due or today or today_iso()
    if recurrence == "daily":
        return add_days(base, 1)
    if recurrence == "weekly":
        return add_days(base, 7)
    if recurrence == "monthly":
        return add_months(base, 1)
    return None


def auto_layout(nodes: list[dict], edges: list[dict]) -> list[dict]:
    keys = [node["key"] for node in nodes]
    incoming: dict[str, int] = {key: 0 for key in keys}
    outgoing: dict[str, list[str]] = {key: [] for key in keys}
    for edge in edges:
        if edge["from"] in incoming and edge["to"] in incoming:
            incoming[edge["to"]] += 1
            outgoing[edge["from"]].append(edge["to"])

    depth: dict[str, int] = {}
    queue = [key for key in keys if incoming[key] == 0]
    for key in queue:
        depth[key] = 0
    seen = set(queue)
    while queue:
        current = queue.pop(0)
        for child in outgoing[current]:
            depth[child] = max(depth.get(child, 0), depth[current] + 1)
            if child not in seen:
                seen.add(child)
                queue.append(child)
    for key in keys:
        depth.setdefault(key, 0)

    layers: dict[int, list[str]] = {}
    for key in keys:
        layers.setdefault(depth[key], []).append(key)
    positions = {}
    for layer, layer_keys in layers.items():
        for index, key in enumerate(layer_keys):
            positions[key] = {"x": 80 + layer * 300, "y": 80 + index * 170}
    laid_out = []
    for node in nodes:
        laid_out.append({**node, **positions.get(node["key"], {"x": 80, "y": 80})})
    return laid_out


def infer_handles(source_x: float, source_y: float, target_x: float, target_y: float) -> tuple[str, str]:
    dx = target_x - source_x
    dy = target_y - source_y
    if abs(dx) >= abs(dy):
        return ("right", "left") if dx >= 0 else ("left", "right")
    return ("bottom", "top") if dy >= 0 else ("top", "bottom")
