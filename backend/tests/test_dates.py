from datetime import date

from app.dates import apply_recurrence_anchors, apply_schedule_anchors, resolve_schedule_anchors


BRIEF_EXCERPT = """
Campus Events Platform
Work starts next Monday (2026-10-19). A mid-project design review is due Thursday 29 October 2026.
Final submission is due Friday 06 November 2026 at 16:00 UK time.
Kickoff / repo + environment ready - starting next Monday (2026-10-19)
Design review (IA + key screens) - due Thursday 29 October 2026
Final submission (code + short report, max 4 pages) - due Friday 06 November 2026 at 16:00
"""


def test_due_friday_from_monday():
    today = date(2026, 10, 12)  # Monday
    anchors = resolve_schedule_anchors(
        "Go into detail about the full implementation plan for my assignment due Friday.",
        today=today,
    )
    assert anchors["deadline"] == "2026-10-16"
    assert "Friday" in anchors["deadlineLabel"] or "2026-10-16" in anchors["deadlineLabel"]


def test_starting_next_monday():
    today = date(2026, 10, 12)  # Monday
    anchors = resolve_schedule_anchors("Holiday starting next Monday", today=today)
    assert anchors["start"] == "2026-10-19"


def test_starts_next_monday_verb_form():
    today = date(2026, 10, 12)
    anchors = resolve_schedule_anchors("Work starts next Monday", today=today)
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


def test_brief_prefers_final_friday_over_kickoff_iso():
    today = date(2026, 10, 12)
    anchors = resolve_schedule_anchors(
        "Using the brief, create a detailed plan for how to achieve this, make sure the dates are correct",
        today=today,
        document_text=BRIEF_EXCERPT,
    )
    assert anchors["deadline"] == "2026-11-06"
    assert anchors["start"] == "2026-10-19"

    nodes = [
        {"key": "setup", "title": "Project Setup", "dueDate": None},
        {"key": "auth", "title": "Implement Auth Feature", "dueDate": None},
        {"key": "submit", "title": "Final Submission", "dueDate": "2026-10-19"},
    ]
    fixed, _ = apply_schedule_anchors(nodes, [], anchors)
    assert fixed[-1]["dueDate"] == "2026-11-06"
    assert fixed[0]["dueDate"] == "2026-10-19"
    assert fixed[0]["dueDate"] < fixed[-1]["dueDate"]


def test_due_friday_with_explicit_calendar_date():
    today = date(2026, 10, 12)
    anchors = resolve_schedule_anchors(
        "Final submission is due Friday 06 November 2026 at 16:00",
        today=today,
    )
    assert anchors["deadline"] == "2026-11-06"


def test_prompt_includes_hard_deadline():
    from app.generate import build_prompt

    today = date(2026, 10, 12)
    anchors = resolve_schedule_anchors("assignment due Friday", today=today)
    prompt = build_prompt("assignment due Friday", "quick", today=today, anchors=anchors)
    assert "2026-10-16" in prompt
    assert "Hard date anchors" in prompt


def test_every_monday_recurrence():
    today = date(2026, 10, 12)  # Monday
    idea = "Create a plan to go swim every monday."
    anchors = resolve_schedule_anchors(idea, today=today)
    assert anchors["recurrence"] == "weekly"
    assert anchors["recurrenceDueDate"] == "2026-10-12"
    assert anchors["recurrenceWeekday"] == "monday"

    nodes = [{"key": "swim", "title": "Go swimming", "dueDate": None}]
    todos = [{"text": "Swim once", "nodeKey": "swim", "dueDate": "2026-10-20", "recurrence": "none"}]
    fixed_nodes, fixed_todos = apply_recurrence_anchors(nodes, todos, anchors, idea)
    assert fixed_nodes[0]["dueDate"] == "2026-10-12"
    assert any(todo["recurrence"] == "weekly" and todo["dueDate"] == "2026-10-12" for todo in fixed_todos)


def test_every_monday_creates_todo_when_missing():
    today = date(2026, 10, 14)  # Wednesday -> next Monday 19th
    idea = "Create a plan to go swim every monday"
    anchors = resolve_schedule_anchors(idea, today=today)
    assert anchors["recurrenceDueDate"] == "2026-10-19"
    nodes = [{"key": "swim", "title": "Swim", "dueDate": None}]
    _, todos = apply_recurrence_anchors(nodes, [], anchors, idea)
    assert len(todos) == 1
    assert todos[0]["recurrence"] == "weekly"
    assert todos[0]["dueDate"] == "2026-10-19"
