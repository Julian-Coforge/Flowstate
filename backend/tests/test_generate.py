import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.errors import HttpError
from app.generate import call_openai, generate_plan, parse_plan_payload


GOOD_PLAN = {
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
    assert result["edges"] == [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}]
    assert result["todos"][0]["text"] == "Book a slot"


def test_generate_plan_retries_then_fails():
    settings = Settings(openai_api_key="sk-test")
    with patch("app.generate.call_openai", return_value='{"nodes":[]}'):
        with pytest.raises(HttpError) as exc:
            generate_plan(settings, "bad", "quick")
    assert exc.value.status == 422
