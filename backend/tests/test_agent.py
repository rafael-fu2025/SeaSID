"""
Tests for the LLM Agent (tool registry, handlers, briefing).

Covers:
1. Tool registry has all 7 tools (6 v2 + get_air_quality added in v2.1)
2. Tool handlers return valid JSON
3. Agent returns graceful message when API key is missing
"""

import json
import os
import sys
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
        """Agent returns graceful message when API key is missing.

        The real `.env` may have OPENAI_API_KEY set; load_dotenv() runs at
        module import time and would re-populate it. Stub the agent module's
        ``os.getenv`` so chat() sees an empty key regardless.
        """
        import app.lib.agent as _agent

        def _fake_getenv(key, default=""):
            if key == "OPENAI_API_KEY":
                return ""
            return os.environ.get(key, default)

        monkeypatch.setattr(_agent.os, "getenv", _fake_getenv)

        result = await _agent.chat("Hello")

        assert "response" in result
        assert "conversation_id" in result
        # Should mention API key or configuration
        assert "API key" in result["response"] or "not configured" in result["response"] or "not installed" in result["response"] 
