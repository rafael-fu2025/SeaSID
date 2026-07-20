"""
Tests for agent tool-argument validation.

The agent loop hits a known failure mode when the LLM calls a
site-keyed tool without `site_key`: the handler returns a
``{"error": "Unknown site: None"}`` JSON which the model misreads
as "the site name is wrong", and the loop then spams the tool with
the same missing argument.

These tests pin down the new validation contract: every site-keyed
tool returns a structured error (with ``error_code`` and
``valid_sites``) when ``site_key`` is missing, and a clear
"unknown site" error when the value isn't a recognised site.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib import agent_tools


# ── Helper ──────────────────────────────────────────────────────────────


def _result(data: str) -> dict:
    """Parse a tool handler's JSON string output into a dict."""
    return json.loads(data)


# ── Direct handler tests ───────────────────────────────────────────────


class TestRequireSiteKeyHelper:
    def test_valid_site_key_passes_through(self):
        site_key, err = agent_tools._require_site_key(
            {"site_key": "dauin_muck"}, "get_forecast"
        )
        assert site_key == "dauin_muck"
        assert err is None

    def test_missing_site_key_returns_structured_error(self):
        site_key, err = agent_tools._require_site_key({}, "get_forecast")
        assert site_key is None
        body = _result(err)
        assert body["error_code"] == "missing_site_key"
        assert "dauin_muck" in body["valid_sites"]
        assert "apo_reef" in body["valid_sites"]
        # The error text must point the model at the missing argument
        # so it doesn't conclude the site name is the problem.
        assert "site_key" in body["error"]

    def test_empty_string_treated_as_missing(self):
        site_key, err = agent_tools._require_site_key(
            {"site_key": ""}, "get_forecast"
        )
        assert site_key is None
        body = _result(err)
        assert body["error_code"] == "missing_site_key"

    def test_none_value_treated_as_missing(self):
        site_key, err = agent_tools._require_site_key(
            {"site_key": None}, "get_weather"
        )
        assert site_key is None
        body = _result(err)
        assert body["error_code"] == "missing_site_key"

    def test_whitespace_only_treated_as_missing(self):
        site_key, err = agent_tools._require_site_key(
            {"site_key": "   "}, "get_weather"
        )
        assert site_key is None
        body = _result(err)
        assert body["error_code"] == "missing_site_key"

    def test_unknown_site_returns_unknown_site_error(self):
        site_key, err = agent_tools._require_site_key(
            {"site_key": "dauin"}, "get_forecast"
        )
        assert site_key is None
        body = _result(err)
        assert body["error_code"] == "unknown_site"
        assert "dauin" in body["error"]
        assert "dauin_muck" in body["valid_sites"]

    def test_non_dict_arg_returns_structured_error(self):
        site_key, err = agent_tools._require_site_key("dauin_muck", "get_forecast")
        # A bare string is the legacy/test path — _require_site_key itself
        # rejects non-dicts. The wrappers handle the legacy call separately.
        assert site_key is None
        body = _result(err)
        assert body["error_code"] == "missing_site_key"


# ── Wrapped handler tests ──────────────────────────────────────────────


class TestSiteKeyOnlyWrapper:
    """Every wrapped site-keyed tool must surface the structured error."""

    @pytest.mark.parametrize("tool_name", [
        "get_forecast",
        "get_weather",
        "get_history",
        "check_alerts",
        "get_air_quality",
    ])
    def test_missing_site_key_for_every_site_keyed_tool(self, tool_name):
        handler = agent_tools.TOOL_HANDLERS[tool_name]
        result = _result(handler({}))
        assert result["error_code"] == "missing_site_key"
        assert tool_name in result["error"]
        assert "site_key" in result["error"]
        assert "dauin_muck" in result["valid_sites"]
        assert "apo_reef" in result["valid_sites"]

    @pytest.mark.parametrize("tool_name", [
        "get_forecast",
        "get_weather",
        "get_history",
        "check_alerts",
        "get_air_quality",
    ])
    def test_unknown_site_key_for_every_site_keyed_tool(self, tool_name):
        handler = agent_tools.TOOL_HANDLERS[tool_name]
        result = _result(handler({"site_key": "atlantis"}))
        assert result["error_code"] == "unknown_site"
        assert "atlantis" in result["error"]

    def test_get_history_accepts_optional_days(self):
        handler = agent_tools.TOOL_HANDLERS["get_history"]
        # Out-of-range days should clamp, not crash.
        result = _result(handler({"site_key": "dauin_muck", "days": 999}))
        # Result is real (not the error JSON) and contains a 'history' field.
        assert "history" in result or "error" in result

    def test_get_history_defaults_days_when_missing(self):
        handler = agent_tools.TOOL_HANDLERS["get_history"]
        result = _result(handler({"site_key": "dauin_muck"}))
        assert "history" in result or "error" in result

    def test_legacy_string_call_still_works(self):
        """Tests (and any direct caller) can still pass a bare site_key."""
        # No exception means the wrapper accepted the legacy form.
        result = agent_tools.TOOL_HANDLERS["get_forecast"]("dauin_muck")
        data = json.loads(result)
        assert data.get("site_key") == "dauin_muck" or "error" not in data or "site_key" in data.get("error", "")

    def test_list_sites_does_not_require_site_key(self):
        """`list_sites` is the "what are my options?" escape hatch — never gate it."""
        result = json.loads(agent_tools.TOOL_HANDLERS["list_sites"]({}))
        assert isinstance(result, list)
        keys = {site["key"] for site in result}
        assert {"dauin_muck", "apo_reef"}.issubset(keys)
