from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Iterable


def _status(node: dict | object) -> str:
    return node["status"] if isinstance(node, dict) else node.status


def _checklist(node: dict | object) -> list:
    if isinstance(node, dict):
        return list(node.get("checklist") or [])
    return list(getattr(node, "checklist", None) or [])


def _check_done(item: dict | object) -> bool:
    if isinstance(item, dict):
        return bool(item.get("done"))
    return bool(getattr(item, "done", False))


def node_completion(node: dict | object) -> float:
    """0–1 completion for a step, using status and checklist progress."""
    status = _status(node)
    if status == "done":
        return 1.0
    status_part = 0.5 if status == "doing" else 0.0
    checks = _checklist(node)
    if not checks:
        return status_part
    check_part = sum(1 for item in checks if _check_done(item)) / len(checks)
    return min(0.99, 0.35 * status_part + 0.65 * check_part)


def progress(nodes: Iterable[dict | object]) -> dict:
    rows = list(nodes)
    total = len(rows)
    if total == 0:
        return {"done": 0, "total": 0, "percent": 0}
    done = sum(1 for node in rows if _status(node) == "done")
    # Match JS Math.round (half-up for positive values), not banker's round().
    percent = int((sum(node_completion(node) for node in rows) / total) * 100 + 0.5)
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


# Collapsed step card size (matches canvas `w-44`) and tidy spacing.
_NODE_W = 176.0
_NODE_H = 72.0
_GAP_X = 360.0
_GAP_Y = 200.0


def auto_layout(nodes: list[dict], edges: list[dict]) -> list[dict]:
    keys = [node["key"] for node in nodes]
    incoming: dict[str, int] = {key: 0 for key in keys}
    outgoing: dict[str, list[str]] = {key: [] for key in keys}
    parents: dict[str, list[str]] = {key: [] for key in keys}
    for edge in edges:
        if edge["from"] in incoming and edge["to"] in incoming:
            incoming[edge["to"]] += 1
            outgoing[edge["from"]].append(edge["to"])
            parents[edge["to"]].append(edge["from"])

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

    # Stable seed order, then barycentre sweeps so linked steps sit nearer each other
    # and edges are less likely to thread through unrelated cards.
    seed = {key: index for index, key in enumerate(keys)}
    layer_order = sorted(layers)
    for layer in layer_order:
        layers[layer] = sorted(layers[layer], key=lambda key: seed[key])

    def _median(values: list[float]) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        mid = len(ordered) // 2
        if len(ordered) % 2:
            return ordered[mid]
        return (ordered[mid - 1] + ordered[mid]) / 2

    for _ in range(4):
        for layer in layer_order[1:]:
            index_of = {key: index for index, key in enumerate(layers[layer - 1])}

            def parent_score(key: str, idx: dict[str, int] = index_of) -> tuple[float, int]:
                linked = [idx[parent] for parent in parents[key] if parent in idx]
                return (_median([float(value) for value in linked]) if linked else float(seed[key]), seed[key])

            layers[layer] = sorted(layers[layer], key=parent_score)
        for layer in reversed(layer_order[:-1]):
            index_of = {key: index for index, key in enumerate(layers[layer + 1])}

            def child_score(key: str, idx: dict[str, int] = index_of) -> tuple[float, int]:
                linked = [idx[child] for child in outgoing[key] if child in idx]
                return (_median([float(value) for value in linked]) if linked else float(seed[key]), seed[key])

            layers[layer] = sorted(layers[layer], key=child_score)

    positions = {}
    max_layer_size = max((len(layer_keys) for layer_keys in layers.values()), default=1)
    for layer, layer_keys in layers.items():
        # Center narrower layers (e.g. remerge/submit) against wider parallel branches.
        y_offset = ((max_layer_size - len(layer_keys)) * _GAP_Y) / 2
        for index, key in enumerate(layer_keys):
            positions[key] = {"x": 80 + layer * _GAP_X, "y": 80 + y_offset + index * _GAP_Y}
    laid_out = []
    for node in nodes:
        laid_out.append({**node, **positions.get(node["key"], {"x": 80, "y": 80})})
    return laid_out


def infer_handles(source_x: float, source_y: float, target_x: float, target_y: float) -> tuple[str, str]:
    """Pick handles so SmoothStep bends sit in the gutter between columns, not through cards."""
    dx = (target_x + _NODE_W / 2) - (source_x + _NODE_W / 2)
    dy = (target_y + _NODE_H / 2) - (source_y + _NODE_H / 2)
    adx = abs(dx)
    ady = abs(dy)

    # Layer hops: opposite left/right sides keep the vertical run in the column gutter.
    if adx >= _NODE_W * 0.55:
        return ("right", "left") if dx >= 0 else ("left", "right")
    # Same-column stack: top/bottom.
    if ady >= _NODE_H * 0.55:
        return ("bottom", "top") if dy >= 0 else ("top", "bottom")
    if adx >= ady:
        return ("right", "left") if dx >= 0 else ("left", "right")
    return ("bottom", "top") if dy >= 0 else ("top", "bottom")
