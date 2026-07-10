"""
LLM Agent for SeaSID using OpenAI function-calling.

Provides natural-language dive condition Q&A and briefing generation.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv

from app.lib.agent_tools import TOOL_DEFINITIONS, TOOL_HANDLERS

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

Available sites:
- dauin_muck: Dauin Muck Bays (muck diving, black sand)
- apo_reef: Apo Island Reef (reef diving, marine sanctuary)
"""

MAX_TOOL_ROUNDS = 5


async def chat(
    user_message: str,
    conversation_id: str | None = None,
    site_key: str | None = None,
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

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {
            "response": "API key not configured. Please set OPENAI_API_KEY in your .env file.",
            "conversation_id": conversation_id or str(uuid.uuid4()),
            "tool_calls": [],
        }

    model = os.getenv("OPENAI_MODEL", "MiniMax-M1").strip()
    base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    if conversation_id is None:
        conversation_id = str(uuid.uuid4())

    # Build messages
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Load conversation history
    history = _load_history(conversation_id)
    messages.extend(history)

    # Add site context if provided
    if site_key:
        user_message = f"[Context: The user is asking about site '{site_key}'] {user_message}"

    messages.append({"role": "user", "content": user_message})

    # Save user message
    _save_message(conversation_id, "user", user_message, site_key=site_key)

    tool_calls_log = []

    # ── Agent loop (up to MAX_TOOL_ROUNDS) ─────────────────────────────
    for round_num in range(MAX_TOOL_ROUNDS):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
                temperature=0.3,
                max_tokens=1024,
            )
        except Exception as exc:
            logger.error("OpenAI API error: %s", exc)
            return {
                "response": f"I'm having trouble connecting to the AI service: {exc}",
                "conversation_id": conversation_id,
                "tool_calls": tool_calls_log,
            }

        choice = response.choices[0]

        # If no tool calls, we have the final response
        if choice.finish_reason == "stop" or not choice.message.tool_calls:
            assistant_content = choice.message.content or ""
            _save_message(conversation_id, "assistant", assistant_content)

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

            handler = TOOL_HANDLERS.get(func_name)
            if handler:
                try:
                    result = handler(func_args)
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


async def generate_briefing(site_key: str) -> dict:
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

    result = await chat(prompt, site_key=site_key)
    result["site_key"] = site_key
    result["type"] = "briefing"
    return result


# ── History management ─────────────────────────────────────────────────────

def _load_history(conversation_id: str, max_messages: int = 20) -> list[dict]:
    """Load recent conversation history from the database."""
    try:
        from app.lib import db

        session = db.SessionLocal()
        try:
            rows = (
                session.query(db.AgentConversation)
                .filter(db.AgentConversation.conversation_id == conversation_id)
                .order_by(db.AgentConversation.ts.desc())
                .limit(max_messages)
                .all()
            )

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
) -> None:
    """Save a message to the conversation history."""
    try:
        from app.lib import db

        session = db.SessionLocal()
        try:
            msg = db.AgentConversation(
                conversation_id=conversation_id,
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
