"""
Tests for the LLM Agent (tool registry, handlers, briefing).

Covers:
1. Tool registry has all 7 tools (6 v2 + get_air_quality added in v2.1)
2. Tool handlers return valid JSON
3. Agent returns graceful message when API key is missing
"""

import json
import sys
from types import SimpleNamespace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.agent_tools import TOOL_DEFINITIONS, TOOL_HANDLERS


class TestToolRegistry:
    """Test the tool registry is complete."""

    def test_tool_count(self):
        """Should have exactly 7 tools defined (6 v2 + get_air_quality added in v2.1)."""
        assert len(TOOL_DEFINITIONS) == 7

    def test_all_tools_have_handlers(self):
        """Every defined tool should have a corresponding handler."""
        for tool_def in TOOL_DEFINITIONS:
            name = tool_def["function"]["name"]
            assert name in TOOL_HANDLERS, f"Missing handler for tool: {name}"

    def test_tool_names(self):
        """Verify expected tool names exist (v2.1 contract)."""
        names = {t["function"]["name"] for t in TOOL_DEFINITIONS}
        expected = {
            "get_forecast",
            "get_weather",
            "list_sites",
            "get_model_info",
            "get_history",
            "check_alerts",
            "get_air_quality",
        }
        assert names == expected


class TestToolHandlers:
    """Test that tool handlers produce valid JSON output."""

    def test_list_sites_returns_json(self):
        """list_sites handler returns valid JSON array."""
        result = TOOL_HANDLERS["list_sites"]({})
        data = json.loads(result)
        assert isinstance(data, list)
        assert len(data) == 2  # dauin_muck + apo_reef
        assert data[0]["key"] in ("dauin_muck", "apo_reef")

    def test_get_forecast_unknown_site(self):
        """get_forecast with unknown site returns error JSON."""
        result = TOOL_HANDLERS["get_forecast"]({"site_key": "nonexistent"})
        data = json.loads(result)
        assert "error" in data

    def test_get_weather_unknown_site(self):
        """get_weather with unknown site returns error JSON."""
        result = TOOL_HANDLERS["get_weather"]({"site_key": "nonexistent"})
        data = json.loads(result)
        assert "error" in data

    def test_get_forecast_valid_site(self):
        """get_forecast with valid site returns structured data."""
        result = TOOL_HANDLERS["get_forecast"]({"site_key": "dauin_muck"})
        data = json.loads(result)
        assert "site" in data
        assert "overall_risk" in data
        assert "p_no_go" in data

    def test_get_model_info_returns_json(self):
        """get_model_info returns valid JSON."""
        result = TOOL_HANDLERS["get_model_info"]({})
        data = json.loads(result)
        assert "model_type" in data or "error" in data

    def test_check_alerts_unknown_site(self):
        """check_alerts with unknown site returns error JSON."""
        result = TOOL_HANDLERS["check_alerts"]({"site_key": "nonexistent"})
        data = json.loads(result)
        assert "error" in data


class TestAgentChat:
    """Test agent chat function."""

    @pytest.mark.asyncio
    async def test_chat_no_api_key(self, monkeypatch):
        """Environment credentials remain available as a deployment fallback."""
        import app.lib.agent as _agent

        monkeypatch.setenv("OPENAI_API_KEY", "sk-environment-fallback")
        monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")

        provider_store, key_record, base_url = _agent._resolve_llm_runtime()

        assert provider_store is None
        assert key_record.value == "sk-environment-fallback"
        assert base_url == "https://example.test/v1"

    @pytest.mark.asyncio
    async def test_stream_uses_edited_database_key_and_base_url(self, monkeypatch):
        import app.lib.agent as _agent
        from app.lib import provider_keys

        created = provider_keys.create_provider_key(
            provider="llm",
            label="primary",
            value="sk-before-edit",
        )
        provider_keys.update_provider_key(created["id"], value="sk-after-edit")
        provider_keys.update_provider_config(
            "llm",
            base_url="https://llm.example.test/v1",
            updated_by_subject="admin",
        )

        captured = {}

        class FakeStream:
            async def _chunks(self):
                yield SimpleNamespace(
                    choices=[SimpleNamespace(
                        delta=SimpleNamespace(content="connected", tool_calls=None),
                        finish_reason="stop",
                    )],
                    usage=None,
                )

            def __aiter__(self):
                return self._chunks()

        class FakeCompletions:
            async def create(self, **kwargs):
                captured["request"] = kwargs
                return FakeStream()

        class FakeAsyncOpenAI:
            def __init__(self, *, api_key, base_url):
                captured["api_key"] = api_key
                captured["base_url"] = base_url
                self.chat = SimpleNamespace(completions=FakeCompletions())

        monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI))

        events = [event async for event in _agent.chat_stream("Hello")]

        assert captured["api_key"] == "sk-after-edit"
        assert captured["base_url"] == "https://llm.example.test/v1"
        assert any(event.get("type") == "text" for event in events)
        assert events[-1]["type"] == "done"
