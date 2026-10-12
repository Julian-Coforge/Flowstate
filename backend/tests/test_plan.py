from pydantic import ValidationError
import pytest

from app.schemas import Plan, validate_plan


GOOD = {
    "nodes": [
        {"key": "a", "title": "Research", "description": "", "importance": "medium", "checklist": ["Read"]},
        {"key": "b", "title": "Build", "description": "", "importance": "high", "checklist": []},
        {"key": "c", "title": "Review", "description": "", "importance": "low", "checklist": []},
        {"key": "d", "title": "Ship", "description": "", "importance": "medium", "checklist": []},
        {"key": "e", "title": "Tell people", "description": "", "importance": "low", "checklist": []},
    ],
    "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}],
    "todos": [{"text": "Book a slot", "nodeKey": "d"}],
}


def test_plan_accepts_good_fixture():
    plan = Plan.model_validate(GOOD)
    validate_plan(plan, "quick")


def test_plan_rejects_too_few_nodes():
    plan = Plan.model_validate({"nodes": GOOD["nodes"][:2], "edges": [], "todos": []})
    with pytest.raises(ValueError):
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
