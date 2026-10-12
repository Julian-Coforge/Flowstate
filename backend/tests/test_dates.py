from datetime import date

from app.dates import apply_schedule_anchors, resolve_schedule_anchors


def test_due_friday_from_monday():
    today = date(2026, 10, 12)  # Monday
    anchors = resolve_schedule_anchors(
        "Go into detail about the full implementation plan for my assignment due Friday.",
        today=today,
    )
    assert anchors["deadline"] == "2026-10-16"
    assert "Friday" in anchors["deadlineLabel"]


def test_starting_next_monday():
    today = date(2026, 10, 12)  # Monday
    anchors = resolve_schedule_anchors("Holiday starting next Monday", today=today)
    assert anchors["start"] == "2026-10-19"


def test_apply_deadline_forces_submit_friday():
    today = date(2026, 10, 12)
    anchors = resolve_schedule_anchors("assignment due Friday", today=today)
    nodes = [
        {"key": "a", "title": "Setup", "dueDate": "2026-10-13"},
        {"key": "b", "title": "Build", "dueDate": "2026-10-18"},
        {"key": "c", "title": "Submit Project", "dueDate": "2026-10-20"},
    ]
    todos = [{"text": "Submit the repo", "dueDate": "2026-10-20", "recurrence": "none"}]
    fixed_nodes, fixed_todos = apply_schedule_anchors(nodes, todos, anchors)
    assert fixed_nodes[-1]["dueDate"] == "2026-10-16"
    assert all(node["dueDate"] <= "2026-10-16" for node in fixed_nodes)
    assert fixed_todos[0]["dueDate"] == "2026-10-16"


def test_prompt_includes_hard_deadline():
    from app.generate import build_prompt

    today = date(2026, 10, 12)
    anchors = resolve_schedule_anchors("assignment due Friday", today=today)
    prompt = build_prompt("assignment due Friday", "quick", today=today, anchors=anchors)
    assert "2026-10-16" in prompt
    assert "Hard date anchors" in prompt
