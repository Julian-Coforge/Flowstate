import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.errors import HttpError
from app.generate import call_openai, generate_plan, parse_plan_payload


GOOD_PLAN = {
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


def test_parse_plan_payload_accepts_json():
    plan = parse_plan_payload(json.dumps(GOOD_PLAN), "quick")
    assert len(plan.nodes) == 5


def test_call_openai_uses_chat_completions():
    settings = Settings(openai_api_key="sk-test", ai_model_quick="gpt-4o-mini")
    fake_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(GOOD_PLAN)))]
    )
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_response

    with patch("openai.OpenAI", return_value=fake_client) as openai_cls:
        raw = call_openai(settings, "Plant a garden", "quick")

    openai_cls.assert_called_once()
    kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "gpt-4o-mini"
    assert kwargs["response_format"] == {"type": "json_object"}
    assert "Plant a garden" in kwargs["messages"][1]["content"]
    assert json.loads(raw)["nodes"][0]["key"] == "a"


def test_generate_plan_returns_layouted_nodes():
    settings = Settings(openai_api_key="sk-test")
    with patch("app.generate.call_openai", return_value=json.dumps(GOOD_PLAN)):
        result = generate_plan(settings, "Plant a garden", "quick")
    assert len(result["nodes"]) == 5
    assert all("x" in node and "y" in node for node in result["nodes"])
    assert result["nodes"][0]["dueDate"] == "2026-11-01"
    assert result["edges"] == [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}]
    assert result["todos"][0]["text"] == "Book a slot"
    assert result["todos"][0]["dueDate"] == "2026-11-08"


def test_build_prompt_includes_today_and_calendar_rules():
    from datetime import date

    from app.generate import build_prompt

    prompt = build_prompt("Holiday next Monday", "quick", today=date(2026, 10, 12))
    assert "2026-10-12" in prompt
    assert "Monday" in prompt
    assert "dueDate" in prompt
    assert "recurrence" in prompt
    assert "Holiday next Monday" in prompt


def test_build_prompt_includes_attached_document():
    from datetime import date

    from app.generate import build_prompt

    prompt = build_prompt(
        "Use the brief",
        "quick",
        today=date(2026, 10, 12),
        document_text="Leave on 20 November.",
    )
    assert "Leave on 20 November." in prompt
    assert "BEGIN DOCUMENT" in prompt
    assert "one node per major requirement" in prompt
    assert "Diverge" in prompt
    assert "Remerge" in prompt


def test_generate_plan_retries_then_fails():
    settings = Settings(openai_api_key="sk-test")
    with patch("app.generate.call_openai", return_value='{"nodes":[]}'):
        with pytest.raises(HttpError) as exc:
            generate_plan(settings, "bad", "quick")
    assert exc.value.status == 422


def test_generate_plan_surfaces_openai_quota_error():
    from openai import RateLimitError
    import httpx

    settings = Settings(openai_api_key="sk-test")
    response = httpx.Response(429, request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"))
    err = RateLimitError(
        "You have no credits remaining.",
        response=response,
        body={"message": "You have no credits remaining.", "code": "insufficient_quota"},
    )
    with patch("app.generate.call_openai", side_effect=err):
        with pytest.raises(HttpError) as exc:
            generate_plan(settings, "Plant a garden", "quick")
    assert exc.value.status == 502
    assert "credits" in exc.value.message.lower()
