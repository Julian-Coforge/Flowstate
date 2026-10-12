from pydantic import ValidationError
import pytest

from app.schemas import Plan, validate_plan


GOOD = {
    "nodes": [
        {"key": "a", "title": "Research", "description": "", "importance": "medium", "checklist": ["Read"], "dueDate": "2026-11-01"},
        {"key": "b", "title": "Build", "description": "", "importance": "high", "checklist": [], "dueDate": "2026-11-05"},
        {"key": "c", "title": "Review", "description": "", "importance": "low", "checklist": []},
        {"key": "d", "title": "Ship", "description": "", "importance": "medium", "checklist": [], "dueDate": "2026-11-10"},
        {"key": "e", "title": "Tell people", "description": "", "importance": "low", "checklist": []},
    ],
    "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}],
    "todos": [{"text": "Book a slot", "nodeKey": "d", "dueDate": "2026-11-08", "recurrence": "none"}],
}


def test_plan_accepts_good_fixture():
    plan = Plan.model_validate(GOOD)
    validate_plan(plan, "quick")


def test_plan_accepts_small_dated_reminder():
    payload = {
        "nodes": [{"key": "shop", "title": "Food shop", "description": "Weekly shop", "importance": "medium", "checklist": [], "dueDate": "2026-11-12"}],
        "edges": [],
        "todos": [{"text": "Weekly shopping", "nodeKey": "shop", "dueDate": "2026-11-12", "recurrence": "weekly"}],
    }
    plan = Plan.model_validate(payload)
    validate_plan(plan, "quick")
    assert plan.todos[0].recurrence == "weekly"
    assert plan.nodes[0].dueDate == "2026-11-12"


def test_document_plan_rejects_two_vague_nodes():
    payload = {
        "nodes": [
            {"key": "prep", "title": "Prepare assignment", "description": "", "importance": "medium", "checklist": []},
            {"key": "submit", "title": "Submit", "description": "", "importance": "medium", "checklist": []},
        ],
        "edges": [{"from": "prep", "to": "submit"}],
        "todos": [],
    }
    plan = Plan.model_validate(payload)
    with pytest.raises(ValueError, match="5–8"):
        validate_plan(plan, "quick", has_document=True)


def test_plan_rejects_empty_nodes():
    plan = Plan.model_validate({"nodes": [], "edges": [], "todos": []})
    with pytest.raises(ValueError):
        validate_plan(plan, "quick")


def test_plan_rejects_repeating_todo_without_date():
    payload = {
        "nodes": [{"key": "shop", "title": "Shop", "description": "", "importance": "medium", "checklist": []}],
        "edges": [],
        "todos": [{"text": "Weekly shopping", "recurrence": "weekly"}],
    }
    plan = Plan.model_validate(payload)
    with pytest.raises(ValueError, match="start date"):
        validate_plan(plan, "quick")


def test_plan_rejects_bad_edge():
    payload = {**GOOD, "edges": [{"from": "a", "to": "a"}]}
    plan = Plan.model_validate(payload)
    with pytest.raises(ValueError):
        validate_plan(plan, "quick")


def test_plan_rejects_unknown_task_key():
    payload = {**GOOD, "todos": [{"text": "Nope", "nodeKey": "missing"}]}
    plan = Plan.model_validate(payload)
    with pytest.raises(ValueError):
        validate_plan(plan, "quick")


def test_malformed_json_rejected():
    with pytest.raises(ValidationError):
        Plan.model_validate({"nodes": "nope"})


def test_plan_rejects_bad_due_date():
    with pytest.raises(ValidationError):
        Plan.model_validate(
            {
                "nodes": [{"key": "a", "title": "A", "dueDate": "12/11/2026"}],
                "edges": [],
                "todos": [],
            }
        )
