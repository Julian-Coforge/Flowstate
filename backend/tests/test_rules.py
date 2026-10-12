from app.rules import add_months, can_link, next_occurrence, progress


def test_progress_splits_done_from_all():
    assert progress([{"status": "done"}, {"status": "todo"}, {"status": "doing"}, {"status": "done"}]) == {
        "done": 2,
        "total": 4,
        "percent": 50,
    }


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
