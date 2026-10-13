from app.rules import add_months, auto_layout, can_link, next_occurrence, progress


def test_progress_blends_status_without_checklists():
    assert progress([{"status": "done"}, {"status": "todo"}, {"status": "doing"}, {"status": "done"}]) == {
        "done": 2,
        "total": 4,
        "percent": 63,
    }


def test_progress_uses_checklist_items():
    assert progress(
        [
            {
                "status": "todo",
                "checklist": [{"done": True}, {"done": True}, {"done": False}, {"done": False}],
            }
        ]
    ) == {"done": 0, "total": 1, "percent": 33}


def test_progress_empty():
    assert progress([]) == {"done": 0, "total": 0, "percent": 0}


def test_can_link_rejects_self_and_duplicates():
    nodes = {"a", "b", "c"}
    assert can_link("a", "c", [("a", "b")], nodes) == {"ok": True}
    assert can_link("a", "a", [], nodes)["ok"] is False
    assert can_link("a", "b", [("a", "b")], nodes)["ok"] is False
    assert can_link("a", "missing", [], nodes)["ok"] is False


def test_month_end_clamps():
    assert add_months("2026-01-31", 1) == "2026-02-28"
    assert next_occurrence("2026-01-31", "monthly") == "2026-02-28"
    assert next_occurrence("2026-10-12", "daily") == "2026-10-13"
    assert next_occurrence("2026-10-12", "weekly") == "2026-10-19"
    assert next_occurrence("2026-10-12", "none") is None


def test_auto_layout_centers_remerge_against_branches():
    nodes = [
        {"key": "setup", "title": "Setup"},
        {"key": "classic", "title": "Classic"},
        {"key": "diff", "title": "Difficulty"},
        {"key": "time", "title": "Time"},
        {"key": "test", "title": "Test"},
    ]
    edges = [
        {"from": "setup", "to": "classic"},
        {"from": "setup", "to": "diff"},
        {"from": "setup", "to": "time"},
        {"from": "classic", "to": "test"},
        {"from": "diff", "to": "test"},
        {"from": "time", "to": "test"},
    ]
    laid = {node["key"]: node for node in auto_layout(nodes, edges)}
    branch_ys = sorted(laid[key]["y"] for key in ("classic", "diff", "time"))
    assert laid["classic"]["x"] == laid["diff"]["x"] == laid["time"]["x"]
    assert laid["test"]["x"] > laid["classic"]["x"]
    # Remerge node should sit roughly in the middle of the parallel branch band.
    assert branch_ys[0] < laid["test"]["y"] < branch_ys[-1]
