"""
LLM Agent for SeaSID using OpenAI function-calling.

Provides natural-language dive condition Q&A and briefing generation.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv

from app.lib.agent_tools import get_active_tool_definitions

logger = logging.getLogger(__name__)

load_dotenv()

SYSTEM_PROMPT = """You are SeaSID, an AI dive safety assistant for the Dauin coast and Apo Island in the Philippines.

Your role:
- Help divers and dive operators assess current diving conditions
- Provide accurate weather, tide, air-quality, and risk assessments
- Generate dive briefings with safety recommendations
- Explain predictions from the SeaSID forecasting model

Key rules:
1. ALWAYS use your tools to get current data before answering questions about conditions.
2. Never fabricate weather data or conditions — use only data from your tools.
3. When uncertain, recommend caution and advise checking with local operators.
4. Express probabilities clearly: "The model estimates a 73% chance of poor conditions."
5. Consider the site type: muck dive sites (Dauin) are more sensitive to runoff than reefs (Apo).
6. For dive briefings, include: conditions summary, key risks, recommendations, and a go/no-go assessment.
7. When haze or smoke is mentioned, call get_air_quality to check PM2.5/AQI before recommending.
8. When the user asks about anything that may have changed since the model's last training cut-off
   (e.g. tropical storms, regional advisories, news, recent port conditions), call `web_search` first
   and cite the source URLs in your answer. Only use web results to enrich a forecast — never replace
   a tool-based check on a SeaSID-managed site.

Tool-argument discipline:
- Every site-keyed tool (`get_forecast`, `get_weather`, `get_history`, `check_alerts`,
  `get_air_quality`) requires a `site_key` string. If you forget the argument the tool will
  return a structured error that says exactly which argument is missing and which values are
  valid. Do not interpret that error as "the site is unknown" — read the `error_code` and
  `valid_sites` fields and re-issue the call with a `site_key` from the list. The two valid
  values are `dauin_muck` and `apo_reef`.
- When comparing two sites (e.g. "compare Dauin and Apo"), call the tool once per site in
  parallel-style turns; never call a site-keyed tool with no arguments and never call `list_sites`
  with arguments.

Available sites:
- dauin_muck: Dauin Muck Bays (muck diving, black sand)
- apo_reef: Apo Island Reef (reef diving, marine sanctuary)
"""

MAX_TOOL_ROUNDS = 5

# Default timezone for the agent's "now" hint. Dauin/Apo live in
# Asia/Manila (UTC+8, no DST). Override via AGENT_TIMEZONE if you run
# SeaSID somewhere else. The value is read inside ``_now_reminder()``
# so test runs (and runtime config reloads) can change it without
# re-importing the module.


def _now_reminder() -> str:
    """Build a short, time-anchored system reminder for the model.

    The LLM has no live clock — without this it falls back on its
    training-data cut-off, which makes `web_search` queries about
    "current" weather, advisories, or port conditions stale (it once
    answered as if it were 2024). The reminder is injected at the very
    top of every turn so the model sees today's date before anything
    else and can frame search queries in the right year.
    """
    tz_name = os.getenv("AGENT_TIMEZONE", "Asia/Manila")
    try:
        from zoneinfo import ZoneInfo

        now = datetime.now(ZoneInfo(tz_name))
    except Exception:
        # zoneinfo missing or bad tz name — fall back to UTC.
        now = datetime.now(timezone.utc)
    weekday = now.strftime("%A")
    # Include seconds so consecutive reminders in a long conversation
    # differ even within the same minute — the model can't pin the
    # exact time, but a moving timestamp reinforces that the reminder
    # is fresh on every turn.
    iso = now.strftime("%Y-%m-%d %H:%M:%S %Z")
    return (
        f"Current local time: {iso} ({weekday}). "
        "Always anchor 'today', 'this week', and 'current' questions to this "
        "date; do not assume a year from training data. When the user asks "
        "about anything time-sensitive (storms, advisories, news, port conditions), "
        "use web_search with year-aware queries before answering."
    )


def _resolve_llm_runtime():
    """Load the next rotating LLM key and shared base URL from the database."""
    try:
        from app.lib import provider_keys

        key_record = provider_keys.pick_provider_key("llm")
        config = provider_keys.get_provider_config("llm")
        return provider_keys, key_record, config.get("base_url")
    except Exception as exc:
        logger.warning("Could not resolve database-backed LLM configuration: %s", exc)
        return None, None, None


async def _guard_stream(response, provider_keys, key_id: int):
    """Convert transport failures during SSE iteration into an explicit event."""
    try:
        async for chunk in response:
            yield chunk
    except Exception as exc:
        if provider_keys is not None:
            provider_keys.mark_provider_error(key_id, str(exc))
        yield {"_seasid_stream_error": str(exc)}
    else:
        if provider_keys is not None:
            provider_keys.clear_provider_error(key_id)


async def chat(
    user_message: str,
    conversation_id: str | None = None,
    site_key: str | None = None,
    owner_id: str | None = None,
) -> dict:
    """
    Process a user message through the agent.

    Returns:
        {
            "response": str,
            "conversation_id": str,
            "tool_calls": list[dict],  # tools that were called
        }
    """
    try:
        from openai import AsyncOpenAI
    except ImportError:
        return {
            "response": "OpenAI library not installed. Please install with: pip install openai",
            "conversation_id": conversation_id or str(uuid.uuid4()),
            "tool_calls": [],
        }

    provider_keys, key_record, base_url = _resolve_llm_runtime()
    if key_record is None:
        return {
            "response": "API key not configured. Add an enabled LLM key in Settings → API keys.",
            "conversation_id": conversation_id or str(uuid.uuid4()),
            "tool_calls": [],
        }

    model = os.getenv("OPENAI_MODEL", "MiniMax-M1").strip()
    client = AsyncOpenAI(api_key=key_record.value, base_url=base_url)

    if conversation_id is None:
        conversation_id = str(uuid.uuid4())

    # Build messages
    # Compose the system prompt: server-injected "today is …" reminder first
    # (so the model anchors time-sensitive questions to the present), then
    # the static persona. The reminder is rebuilt on every turn so long
    # conversations can't drift away from "now".
    messages = [
        {"role": "system", "content": _now_reminder()},
        {"role": "system", "content": SYSTEM_PROMPT},
    ]

    # Load conversation history
    history = _load_history(conversation_id, owner_id=owner_id)
    messages.extend(history)

    # Add site context if provided
    if site_key:
        user_message = f"[Context: The user is asking about site '{site_key}'] {user_message}"

    messages.append({"role": "user", "content": user_message})

    # Save user message
    _save_message(
        conversation_id, "user", user_message,
        site_key=site_key, owner_id=owner_id,
    )

    # Pull the merged tool list (built-ins + MiniMax MCP web tools).
    # Done once per turn so all rounds in the same conversation see the
    # same set; if the MCP goes away mid-turn, the handlers fall back to
    # a friendly "unavailable" message without aborting the loop.
    tool_definitions, tool_handlers = await get_active_tool_definitions()

    tool_calls_log = []

    # ── Agent loop (up to MAX_TOOL_ROUNDS) ─────────────────────────────
    for round_num in range(MAX_TOOL_ROUNDS):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tool_definitions,
                tool_choice="auto",
                temperature=0.3,
                max_tokens=1024,
            )
        except Exception as exc:
            logger.error("OpenAI API error: %s", exc)
            if provider_keys is not None:
                provider_keys.mark_provider_error(key_record.id, str(exc))
            return {
                "response": f"I'm having trouble connecting to the AI service: {exc}",
                "conversation_id": conversation_id,
                "tool_calls": tool_calls_log,
            }

        if provider_keys is not None:
            provider_keys.clear_provider_error(key_record.id)
        choice = response.choices[0]

        # If no tool calls, we have the final response
        if choice.finish_reason == "stop" or not choice.message.tool_calls:
            assistant_content = choice.message.content or ""
            _save_message(conversation_id, "assistant", assistant_content, owner_id=owner_id)

            return {
                "response": assistant_content,
                "conversation_id": conversation_id,
                "tool_calls": tool_calls_log,
            }

        # Process tool calls
        messages.append(choice.message)

        for tool_call in choice.message.tool_calls:
            func_name = tool_call.function.name
            try:
                func_args = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                func_args = {}

            logger.info("Agent calling tool: %s(%s)", func_name, func_args)

            handler = tool_handlers.get(func_name)
            if handler:
                try:
                    result = handler(func_args)
                    if asyncio.iscoroutine(result):
                        result = await result
                except Exception as exc:
                    result = json.dumps({"error": str(exc)})
            else:
                result = json.dumps({"error": f"Unknown tool: {func_name}"})

            tool_calls_log.append({
                "name": func_name,
                "arguments": func_args,
                "result": result,
            })

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

    # Max rounds reached
    return {
        "response": "I've gathered a lot of data but need to wrap up. Based on what I found, please ask a more specific question.",
        "conversation_id": conversation_id,
        "tool_calls": tool_calls_log,
    }


async def generate_briefing(site_key: str, owner_id: str | None = None) -> dict:
    """
    Generate a structured dive briefing for a site.
    Uses the agent with a specific briefing prompt.
    """
    prompt = (
        f"Generate a comprehensive dive briefing for {site_key}. Include:\n"
        f"1. Current conditions summary (weather, visibility, currents)\n"
        f"2. Risk assessment with probability\n"
        f"3. Key safety considerations\n"
        f"4. Go/No-Go recommendation with confidence level\n"
        f"5. Best time to dive today if conditions permit\n"
        f"Format it as a professional dive briefing."
    )

    result = await chat(prompt, site_key=site_key, owner_id=owner_id)
    result["site_key"] = site_key
    result["type"] = "briefing"
    return result


# ── History management ─────────────────────────────────────────────────────

def _load_history(
    conversation_id: str,
    max_messages: int = 20,
    owner_id: str | None = None,
) -> list[dict]:
    """Load recent conversation history from the database."""
    try:
        from app.lib import db

        session = db.SessionLocal()
        try:
            query = session.query(db.AgentConversation).filter(
                db.AgentConversation.conversation_id == conversation_id,
            )
            if owner_id is not None:
                query = query.filter(db.AgentConversation.owner_id == owner_id)
            rows = query.order_by(db.AgentConversation.ts.desc()).limit(max_messages).all()

            messages = []
            for row in reversed(rows):
                messages.append({"role": row.role, "content": row.content})

            return messages
        finally:
            session.close()
    except Exception:
        return []


def _save_message(
    conversation_id: str,
    role: str,
    content: str,
    site_key: str | None = None,
    tool_calls_json: str | None = None,
    owner_id: str | None = None,
) -> None:
    """Save a message to the conversation history."""
    try:
        from app.lib import db

        session = db.SessionLocal()
        try:
            msg = db.AgentConversation(
                conversation_id=conversation_id,
                owner_id=owner_id,
                site_key=site_key,
                role=role,
                content=content,
                tool_calls_json=tool_calls_json,
            )
            session.add(msg)
            session.commit()
        finally:
            session.close()
    except Exception as exc:
        logger.warning("Failed to save agent message: %s", exc)


# ── Streaming agent ────────────────────────────────────────────────────────

async def chat_stream(
    user_message: str,
    conversation_id: str | None = None,
    site_key: str | None = None,
    owner_id: str | None = None,
):
    """
    Streaming variant of `chat()` — yields dict events that the FastAPI
    endpoint serialises as Server-Sent Events.

    Event types:
      - {type: "status",    conversation_id: str}
      - {type: "text",      delta: str}
      - {type: "tool_call", id, name, arguments}
      - {type: "tool_result", id, name, output, durationMs}
      - {type: "usage",     promptTokens, completionTokens, totalTokens}
      - {type: "done",      finishReason, tool_calls: [...]}
      - {type: "error",     message: str}
    """
    import time

    try:
        from openai import AsyncOpenAI
    except ImportError:
        yield {"type": "error", "message": "openai library not installed"}
        return

    provider_keys, key_record, base_url = _resolve_llm_runtime()
    if key_record is None:
        yield {
            "type": "error",
            "message": "LLM API key not configured. Add an enabled key in Settings → API keys.",
        }
        return

    model = os.getenv("OPENAI_MODEL", "MiniMax-M1").strip()
    client = AsyncOpenAI(api_key=key_record.value, base_url=base_url)

    if conversation_id is None:
        conversation_id = str(uuid.uuid4())

    yield {"type": "status", "conversation_id": conversation_id}

    # Build messages
    # Server-injected "today is …" reminder first (so time-sensitive
    # questions anchor to the present), then the static persona. The
    # reminder rebuilds on every turn so long conversations can't drift
    # away from "now".
    messages = [
        {"role": "system", "content": _now_reminder()},
        {"role": "system", "content": SYSTEM_PROMPT},
    ]
    history = _load_history(conversation_id, owner_id=owner_id)
    messages.extend(history)
    if site_key:
        user_message = f"[Context: site='{site_key}'] {user_message}"
    messages.append({"role": "user", "content": user_message})
    _save_message(
        conversation_id, "user", user_message,
        site_key=site_key, owner_id=owner_id,
    )

    tool_calls_log: list[dict] = []

    # Pull the merged tool list (built-ins + MiniMax MCP web tools) once
    # per turn. The MCP may add/remove tools across restarts; if it can't
    # boot, the model just doesn't see the web_search / web_browse entries.
    tool_definitions, tool_handlers = await get_active_tool_definitions()

    for _round in range(MAX_TOOL_ROUNDS):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tool_definitions,
                tool_choice="auto",
                temperature=0.3,
                max_tokens=1024,
                stream=True,
            )
        except Exception as exc:
            logger.error("OpenAI streaming error: %s", exc)
            if provider_keys is not None:
                provider_keys.mark_provider_error(key_record.id, str(exc))
            yield {"type": "error", "message": str(exc)}
            return

        # Build tool calls incrementally across deltas.
        # OpenAI's stream delivers each tool call's pieces in multiple chunks
        # sharing the same `index`; we accumulate until finish_reason="tool_calls".
        tool_calls_in_progress: dict[int, dict] = {}
        finish_reason: str | None = None
        full_content: str = ""
        usage_payload: dict | None = None

        async for chunk in _guard_stream(response, provider_keys, key_record.id):
            if isinstance(chunk, dict) and chunk.get("_seasid_stream_error"):
                yield {
                    "type": "error",
                    "message": f"LLM connection interrupted: {chunk['_seasid_stream_error']}",
                }
                return
            # `chunk.choices` can be empty on usage-only chunks
            if not chunk.choices:
                if getattr(chunk, "usage", None):
                    usage_payload = {
                        "promptTokens": chunk.usage.prompt_tokens,
                        "completionTokens": chunk.usage.completion_tokens,
                    }
                continue

            choice = chunk.choices[0]
            delta = choice.delta

            # 1) text deltas
            if delta and delta.content:
                full_content += delta.content
                yield {"type": "text", "delta": delta.content}

            # 2) tool call deltas
            if delta and delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tool_calls_in_progress:
                        tool_calls_in_progress[idx] = {
                            "id": tc_delta.id or "",
                            "name": (tc_delta.function.name if tc_delta.function else "") or "",
                            "arguments": (
                                tc_delta.function.arguments
                                if tc_delta.function and tc_delta.function.arguments
                                else ""
                            ),
                        }
                    else:
                        if tc_delta.id:
                            tool_calls_in_progress[idx]["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                tool_calls_in_progress[idx]["name"] += tc_delta.function.name
                            if tc_delta.function.arguments:
                                tool_calls_in_progress[idx]["arguments"] += tc_delta.function.arguments

            if choice.finish_reason:
                finish_reason = choice.finish_reason

        # ── Decide what to do with the round's output ────────────────────
        has_tool_calls = (
            finish_reason == "tool_calls" and len(tool_calls_in_progress) > 0
        )

        if not has_tool_calls:
            # Final answer this round.
            if full_content:
                _save_message(conversation_id, "assistant", full_content, owner_id=owner_id)
            if usage_payload:
                yield {"type": "usage", **usage_payload}
            yield {
                "type": "done",
                "finishReason": finish_reason or "stop",
                "tool_calls": tool_calls_log,
            }
            return

        # Execute each tool call synchronously and emit tool_call + tool_result
        # events for the frontend state machine to consume.
        # Build the consolidated assistant message (with the full tool_calls
        # array) so the next request carries the model→assistant turn that
        # the tool results will be replying to. Without this, MiniMax /
        # OpenAI-style APIs reject the tool result with HTTP 400 / code 2013:
        # "tool result's tool id(...) not found".
        assistant_tool_calls = []
        for _idx in sorted(tool_calls_in_progress.keys()):
            tc = tool_calls_in_progress[_idx]
            assistant_tool_calls.append({
                "id": tc["id"],
                "type": "function",
                "function": {
                    "name": tc["name"],
                    "arguments": tc["arguments"],
                },
            })
        messages.append({
            "role": "assistant",
            "content": full_content or None,
            "tool_calls": assistant_tool_calls,
        })

        for _idx in sorted(tool_calls_in_progress.keys()):
            tc = tool_calls_in_progress[_idx]
            try:
                func_args = json.loads(tc["arguments"]) if tc["arguments"] else {}
            except json.JSONDecodeError:
                func_args = {}

            logger.info("Agent streaming tool call: %s(%s)", tc["name"], func_args)
            yield {
                "type": "tool_call",
                "id": tc["id"],
                "name": tc["name"],
                "arguments": func_args,
            }

            t0 = time.monotonic()
            handler = tool_handlers.get(tc["name"])
            if handler:
                try:
                    result = handler(func_args)
                    if asyncio.iscoroutine(result):
                        result = await result
                except Exception as exc:
                    result = json.dumps({"error": str(exc)})
            else:
                result = json.dumps({"error": f"Unknown tool: {tc['name']}"})
            duration_ms = int((time.monotonic() - t0) * 1000)

            yield {
                "type": "tool_result",
                "id": tc["id"],
                "name": tc["name"],
                "output": result,
                "durationMs": duration_ms,
            }

            tool_calls_log.append(
                {"name": tc["name"], "arguments": func_args, "result": result}
            )
            messages.append(
                {"role": "tool", "tool_call_id": tc["id"], "content": result}
            )

        # Loop continues for the next round.

    yield {
        "type": "error",
        "message": "I gathered a lot of data but need to wrap up. Ask a more specific question.",
    }
