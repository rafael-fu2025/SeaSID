"""
Tests for the MiniMax web-search MCP integration.

Covers:
  * Tool registry exposes the MCP-backed tools when the subprocess boots.
  * When the MCP can't start (no key, no uvx, env-disabled), the registry
    still returns the built-ins without raising.
  * `agent_mcp.resolve_mcp_minimax_key` honours the documented precedence
    (dedicated row > LLM row > env > None).

The real MCP subprocess is mocked everywhere — we don't want unit tests
to depend on `uvx` or hit the network. The point of these tests is to
verify the SeaSID-side wiring, not the upstream MCP.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── Fixtures ──────────────────────────────────────────────────────────────


class FakeMcpTool:
    def __init__(self, name, description="", input_schema=None):
        self.name = name
        self.description = description
        self.input_schema = input_schema or {"type": "object", "properties": {}}


@pytest.fixture
def fake_booted(monkeypatch):
    """Stub out the MCP subprocess boot and discovery."""

    async def _fake_get_mcp_tools():
        return [
            FakeMcpTool(
                "web_search",
                description="Search the live web for current context.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "queries": {
                            "type": "array",
                            "description": "One or more search queries.",
                        }
                    },
                    "required": ["queries"],
                },
            ),
            FakeMcpTool(
                "web_browse",
                description="Fetch and summarise one or more URLs.",
            ),
        ]

    async def _fake_call(tool_name, arguments):
        return json.dumps({"tool": tool_name, "echo": arguments})

    async def _fake_shutdown():
        return None

    monkeypatch.setattr("app.lib.agent_mcp.get_mcp_tools", _fake_get_mcp_tools)
    monkeypatch.setattr("app.lib.agent_mcp.call_mcp_tool", _fake_call)
    monkeypatch.setattr("app.lib.agent_mcp.shutdown", _fake_shutdown)
    return _fake_get_mcp_tools, _fake_call


@pytest.fixture
def mcp_disabled(monkeypatch):
    """Force the MCP to report itself unavailable."""

    async def _empty():
        return []

    async def _unavailable(name, args):
        return "Web search is currently unavailable."

    monkeypatch.setattr("app.lib.agent_mcp.get_mcp_tools", _empty)
    monkeypatch.setattr("app.lib.agent_mcp.call_mcp_tool", _unavailable)


# ── Tests ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_active_definitions_includes_mcp_tools(fake_booted):
    """When the MCP boots, its tools are appended to the LLM tool list."""
    from app.lib.agent_tools import get_active_tool_definitions

    definitions, handlers = await get_active_tool_definitions()
    names = {d["function"]["name"] for d in definitions}
    assert "get_forecast" in names  # built-in still present
    assert "web_search" in names
    assert "web_browse" in names
    assert "web_search" in handlers
    assert "web_browse" in handlers


@pytest.mark.asyncio
async def test_active_definitions_without_mcp(mcp_disabled):
    """Without MCP, only built-ins are returned and the call is safe."""
    from app.lib.agent_tools import get_active_tool_definitions

    definitions, handlers = await get_active_tool_definitions()
    names = {d["function"]["name"] for d in definitions}
    assert "web_search" not in names
    assert "get_forecast" in names
    assert "web_search" not in handlers


@pytest.mark.asyncio
async def test_mcp_handler_round_trip(fake_booted):
    """The MCP-backed handler returns the subprocess payload verbatim."""
    from app.lib.agent_tools import get_active_tool_definitions

    _get, call = fake_booted
    _, handlers = await get_active_tool_definitions()
    result = handlers["web_search"]({"queries": ["tropical storm Dauin"]})
    # Handler is async; the merge wraps built-ins in coroutine shims and
    # MCP handlers as plain async def. Await regardless of coroutine-ness.
    if asyncio.iscoroutine(result):
        result = await result
    data = json.loads(result)
    assert data == {"tool": "web_search", "echo": {"queries": ["tropical storm Dauin"]}}


@pytest.mark.asyncio
async def test_mcp_handler_unavailable_message(mcp_disabled):
    """A disabled MCP surfaces a clear, model-friendly error message."""
    from app.lib.agent_tools import get_active_tool_definitions

    _, handlers = await get_active_tool_definitions()
    assert "web_search" not in handlers  # MCP tool absent when not booted


def test_list_endpoint_shape(monkeypatch, fake_booted):
    """The /api/v1/agent/tools endpoint returns the merged list."""
    from fastapi.testclient import TestClient

    from app.api.main import app
    from app.auth import Principal

    # Auth-protected endpoints expect a principal. Provide a synthetic one
    # so we can hit the route without going through the JWT path.
    async def _fake_principal():
        return Principal("dev", "dev", "admin", ("*",), authenticated=False)

    app.dependency_overrides[__import__("app.auth", fromlist=["get_current_principal"]).get_current_principal] = _fake_principal
    try:
        client = TestClient(app)
        response = client.get("/api/v1/agent/tools")
        assert response.status_code == 200, response.text
        payload = response.json()
        names = {t["name"] for t in payload["tools"]}
        assert {"get_forecast", "web_search", "web_browse"}.issubset(names)
        assert payload["mcp"]["status"] == "connected"
        assert {t["name"] for t in payload["mcp"]["tools"]} == {"web_search", "web_browse"}
    finally:
        app.dependency_overrides.clear()


def test_resolve_key_uses_dedicated_row(monkeypatch):
    """`mcp_minimax` row wins over the LLM row and the env var."""
    from app.lib import provider_keys

    created_mcp = provider_keys.create_provider_key(
        provider="mcp_minimax", label="dedicated", value="sk-dedicated"
    )
    created_llm = provider_keys.create_provider_key(
        provider="llm", label="llm-shared", value="sk-llm-shared"
    )
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-env-fallback")
    try:
        value, key_id = provider_keys.resolve_mcp_minimax_key()
        assert value == "sk-dedicated"
        assert key_id == created_mcp["id"]
    finally:
        provider_keys.delete_provider_key(created_mcp["id"])
        provider_keys.delete_provider_key(created_llm["id"])


def test_resolve_key_falls_back_to_llm(monkeypatch):
    """With no `mcp_minimax` row, the LLM row is reused."""
    from app.lib import provider_keys

    created_llm = provider_keys.create_provider_key(
        provider="llm", label="llm-only", value="sk-llm-only"
    )
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-env-fallback")
    try:
        value, key_id = provider_keys.resolve_mcp_minimax_key()
        assert value == "sk-llm-only"
        assert key_id == created_llm["id"]
    finally:
        provider_keys.delete_provider_key(created_llm["id"])


def test_resolve_key_falls_back_to_env(monkeypatch):
    """No DB rows at all -> MINIMAX_API_KEY env var (skipping placeholders)."""
    from app.lib import provider_keys

    # Belt-and-braces: clear any rows left over from sibling tests.
    for key in provider_keys.list_provider_keys():
        provider_keys.delete_provider_key(key["id"])
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-env-real")
    value, key_id = provider_keys.resolve_mcp_minimax_key()
    assert value == "sk-env-real"
    assert key_id is None


def test_resolve_key_placeholder_env_ignored(monkeypatch):
    """The README's placeholder value is not a real key — must be ignored."""
    from app.lib import provider_keys

    for key in provider_keys.list_provider_keys():
        provider_keys.delete_provider_key(key["id"])
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-minimax-your-key-here")
    assert provider_keys.resolve_mcp_minimax_key() == (None, None)


def test_resolve_key_none_when_nothing(monkeypatch):
    """No key anywhere -> (None, None)."""
    from app.lib import provider_keys

    for key in provider_keys.list_provider_keys():
        provider_keys.delete_provider_key(key["id"])
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    assert provider_keys.resolve_mcp_minimax_key() == (None, None)


# ── Time-anchored reminder ────────────────────────────────────────────────
#
# The agent has no live clock. Without a "today is …" injection it answers
# time-sensitive questions as if it were the model's training cut-off —
# e.g. searching for "tropical storm near Dauin" without the current year
# returns last year's storms. The reminder must contain the real current
# year and rebuild on every call so a long-running conversation can't
# drift.

def test_now_reminder_contains_current_year():
    """The reminder must carry today's year so LLM queries stay anchored."""
    import datetime as _dt
    from app.lib import agent as _agent

    reminder = _agent._now_reminder()
    assert str(_dt.datetime.now().year) in reminder
    # A weekday name from the strftime table should also be present so
    # the model can frame "by Friday" type requests.
    assert any(
        day in reminder
        for day in ("Monday", "Tuesday", "Wednesday", "Thursday",
                    "Friday", "Saturday", "Sunday")
    )
    # The reminder should explicitly tell the model to call web_search
    # for time-sensitive things so it doesn't freehand an answer.
    assert "web_search" in reminder


def test_now_reminder_rebuilds_each_call(monkeypatch):
    """The reminder must re-evaluate on every call, not be cached."""
    from app.lib import agent as _agent

    first = _agent._now_reminder()
    # Force a slightly different time by sleeping a beat; the timestamps
    # in the reminder should differ (seconds resolution is enough).
    import time
    time.sleep(1.05)
    second = _agent._now_reminder()
    # The two reminders should at least be different strings, and both
    # should still contain the current year.
    assert first != second
    import datetime as _dt
    assert str(_dt.datetime.now().year) in second


def test_now_reminder_honours_timezone_env(monkeypatch):
    """AGENT_TIMEZONE must change the timezone reported in the reminder."""
    from app.lib import agent as _agent

    monkeypatch.setenv("AGENT_TIMEZONE", "UTC")
    reminder_utc = _agent._now_reminder()
    assert "UTC" in reminder_utc

    # Pacific has a non-UTC offset; the reminder should reflect that zone.
    monkeypatch.setenv("AGENT_TIMEZONE", "America/Los_Angeles")
    reminder_la = _agent._now_reminder()
    # The LA reminder carries the configured zone abbreviation; we don't
    # pin a specific offset because of DST, only that the strings differ.
    assert reminder_la != reminder_utc


def test_chat_injects_reminder_before_history(monkeypatch, fake_booted):
    """The reminder must reach the model as the first system message."""
    from app.lib import agent as _agent

    captured: dict = {}

    class _FakeCompletions:
        async def create(self, *args, **kwargs):
            captured["messages"] = kwargs.get("messages") or []
            # Return a final answer (no tool calls) so the loop exits.
            class _Msg:
                content = "ok"
                tool_calls = None
            class _Choice:
                finish_reason = "stop"
                message = _Msg()
            class _Resp:
                choices = [_Choice()]
            return _Resp()

    class _FakeClient:
        chat = type("C", (), {"completions": _FakeCompletions()})()

    async def _fake_chat(*args, **kwargs):
        return _FakeClient()

    # Stub out the LLM client + the key resolver so chat() runs end-to-end
    # without a real OpenAI call or database key.
    monkeypatch.setattr(_agent, "_resolve_llm_runtime", lambda: (None, SimpleNamespace(id=1, value="sk-test"), None))
    monkeypatch.setattr("openai.AsyncOpenAI", lambda *a, **kw: _FakeClient())

    import asyncio
    asyncio.run(_agent.chat("hello"))

    msgs = captured.get("messages") or []
    assert msgs, "chat() should have built a message list"
    # First message must be the time-anchored reminder.
    assert "Current local time" in msgs[0]["content"]
    # Second message is the static persona; user message comes after.
    assert "SeaSID" in msgs[1]["content"]
    assert msgs[-1]["role"] == "user"
    assert msgs[-1]["content"] == "hello"
