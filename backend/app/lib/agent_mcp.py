"""
MiniMax web-search MCP integration for the SeaSID agent.

Spawns the official ``minimax-coding-plan-mcp`` stdio server on the first
agent call, discovers its tools (``web_search``, ``web_browse``) and
forwards calls from the LLM to the subprocess via JSON-RPC 2.0.

Why a stdio subprocess and not a direct HTTP call?
  The MiniMax MCP is the canonical, supported web-search path. Reusing it
  means SeaSID gets the same queries, batching, Jina extraction, and
  MiniMax-LLM content understanding that every other MiniMax agent gets
  — and the same upgrade path when the MCP evolves.

How the agent uses this:
  ``app.lib.agent`` calls :func:`get_mcp_tools` to merge the MCP's tool
  definitions into the OpenAI function-calling list. When the LLM emits
  a tool_call for ``web_search``/``web_browse``, the handler dispatches
  via :func:`call_mcp_tool`, which sends a JSON-RPC ``tools/call`` to the
  subprocess and returns the textual result.

Process lifecycle:
  The subprocess is created lazily on first use, cached for the lifetime
  of the Python process, and respawned when the API key changes (so a
  freshly-rotated key reaches the MCP without bouncing the whole API).
  Errors during spawn, initialize, or tools/list are caught; if the MCP
  can't come up the agent falls back to its native tools (no web access)
  and the LLM receives a clear "web search unavailable" error message.

Auth:
  The API key is resolved by :func:`app.lib.provider_keys.resolve_mcp_minimax_key`
  — preferring a dedicated ``mcp_minimax`` DB row, then the ``llm`` row,
  then the ``MINIMAX_API_KEY`` env var. The subprocess is spawned with
  the key in its env so it authenticates with the upstream provider.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("seasid.agent_mcp")

# Protocol constants — keep in sync with the reference TypeScript client.
PROTOCOL_VERSION = "2024-11-05"
CLIENT_INFO = {"name": "seasid-agent", "version": "0.1.0"}
MCP_REQUEST_TIMEOUT_S = float(os.getenv("SEASID_MCP_TIMEOUT_S", "60"))

# Where the MCP stages any response files. The reference project suggests
# keeping this outside the project tree to avoid Vite/tsc full-reloads,
# but a project-local default keeps dev installs zero-config. Override
# with MINIMAX_MCP_BASE_PATH if you watch the directory.
_DEFAULT_BASE_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "mcp-minimax"


def _is_enabled() -> bool:
    """Honor an explicit opt-out via env var; default = enabled."""
    flag = os.getenv("SEASID_MCP_MINIMAX_ENABLED", "true").strip().lower()
    return flag not in ("", "0", "false", "off", "no")


def _resolve_uvx() -> str | None:
    """Locate the ``uvx`` binary (installed by the ``uv`` Python tool)."""
    found = shutil.which("uvx")
    if found:
        return found
    # Fallback: `uvx` may live in this venv's Scripts/ (drop-in copy) or
    # in the system Python's Scripts/ that the venv was created from. The
    # standard `shutil.which` lookup only walks PATH, so a relocated
    # install wouldn't be found without this extra nudge.
    import sys
    if sys.prefix:
        candidate = os.path.join(sys.prefix, "Scripts", "uvx.exe")
        if os.path.isfile(candidate):
            return candidate
    return None


def _resolve_base_path() -> Path:
    raw = os.getenv("MINIMAX_MCP_BASE_PATH", "").strip()
    path = Path(raw).expanduser() if raw else _DEFAULT_BASE_PATH
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        logger.warning("Could not create MCP base path %s: %s", path, exc)
    return path


@dataclass
class McpTool:
    """One tool advertised by the MCP server."""

    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)


class McpConnectionError(RuntimeError):
    """Raised when the subprocess can't be reached or initialized."""


class _McpSession:
    """A single live connection to the MiniMax web-search MCP subprocess.

    Holds a long-lived :class:`asyncio.subprocess.Process` and a
    request/response correlation table. All public methods are async
    because the agent loop runs inside FastAPI's event loop.

    The class is internal; external code should use the module-level
    helpers (:func:`ensure_booted`, :func:`get_mcp_tools`,
    :func:`call_mcp_tool`) which handle caching, locking, and
    reconnect-on-error.
    """

    def __init__(self, proc: "asyncio.subprocess.Process", server_name: str) -> None:
        self._proc = proc
        self._server_name = server_name
        self._next_id = 1
        self._buffer = b""
        self._pending: dict[int, asyncio.Future[dict]] = {}
        self._reader_task: asyncio.Task[None] | None = None
        self._closed = False
        self._stderr_task: asyncio.Task[None] | None = None

    @property
    def closed(self) -> bool:
        return self._closed

    async def start(self) -> None:
        """Begin reading stdout/stderr in background tasks."""
        self._reader_task = asyncio.create_task(
            self._read_loop(), name=f"mcp-{self._server_name}-stdout"
        )
        self._stderr_task = asyncio.create_task(
            self._drain_stderr(), name=f"mcp-{self._server_name}-stderr"
        )

    async def _read_loop(self) -> None:
        """Decode newline-delimited JSON-RPC frames from the subprocess."""
        assert self._proc.stdout is not None
        try:
            while not self._closed:
                chunk = await self._proc.stdout.read(4096)
                if not chunk:
                    # EOF — process is gone. Fail every outstanding call so
                    # the agent loop can recover with a friendly error.
                    self._close_with_error(
                        f"MCP server {self._server_name} closed stdout"
                    )
                    return
                self._buffer += chunk
                while b"\n" in self._buffer:
                    line, self._buffer = self._buffer.split(b"\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        frame = json.loads(line.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        continue
                    self._dispatch(frame)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            self._close_with_error(f"MCP read loop crashed: {exc}")

    async def _drain_stderr(self) -> None:
        """Log subprocess stderr at WARNING — usually transport hints."""
        assert self._proc.stderr is not None
        try:
            while not self._closed:
                chunk = await self._proc.stderr.read(4096)
                if not chunk:
                    return
                for line in chunk.decode("utf-8", errors="replace").splitlines():
                    if line.strip():
                        logger.warning("[mcp:%s] %s", self._server_name, line)
        except asyncio.CancelledError:
            return
        except Exception:
            return

    def _dispatch(self, frame: dict) -> None:
        """Route one JSON-RPC frame to the matching pending future."""
        frame_id = frame.get("id")
        if not isinstance(frame_id, int):
            # Notification from the server; we don't expect any right now.
            return
        fut = self._pending.pop(frame_id, None)
        if fut is None or fut.done():
            return
        if "error" in frame:
            err = frame["error"] or {}
            fut.set_exception(
                McpConnectionError(
                    f"{err.get('message', 'unknown error')} (code={err.get('code')})"
                )
            )
        else:
            fut.set_result(frame.get("result", {}))

    def _close_with_error(self, message: str) -> None:
        if self._closed:
            return
        self._closed = True
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(McpConnectionError(message))
        self._pending.clear()

    async def request(self, method: str, params: dict | None = None) -> dict:
        """Send one JSON-RPC request and await the matching response."""
        if self._closed:
            raise McpConnectionError(f"MCP server {self._server_name} is closed")
        req_id = self._next_id
        self._next_id += 1
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[dict] = loop.create_future()
        self._pending[req_id] = fut
        frame = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}
        try:
            assert self._proc.stdin is not None
            self._proc.stdin.write((json.dumps(frame) + "\n").encode("utf-8"))
            await self._proc.stdin.drain()
        except Exception as exc:
            self._pending.pop(req_id, None)
            raise McpConnectionError(f"Failed to write to MCP stdin: {exc}") from exc
        try:
            return await asyncio.wait_for(fut, timeout=MCP_REQUEST_TIMEOUT_S)
        except asyncio.TimeoutError as exc:
            self._pending.pop(req_id, None)
            raise McpConnectionError(
                f"MCP {method} (id={req_id}) timed out after {MCP_REQUEST_TIMEOUT_S}s"
            ) from exc

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for task in (self._reader_task, self._stderr_task):
            if task is not None:
                task.cancel()
        try:
            if self._proc.returncode is None:
                self._proc.terminate()
                try:
                    await asyncio.wait_for(self._proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    self._proc.kill()
                    await self._proc.wait()
        except ProcessLookupError:
            pass
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(McpConnectionError("MCP session closed"))
        self._pending.clear()


# ── Module-level cache ────────────────────────────────────────────────────
#
# The subprocess is process-wide. We hold a single live session and rebuild
# it when the key changes. A lock serializes concurrent boot attempts so
# two parallel agent calls don't race to spawn the same server.

_session: _McpSession | None = None
_tools_cache: list[McpTool] | None = None
_key_id_in_use: int | None = None
_lock = threading.Lock()


async def _spawn_session(api_key: str) -> _McpSession:
    """Spawn the ``minimax-coding-plan-mcp`` subprocess and initialize it."""
    uvx = _resolve_uvx()
    if not uvx:
        raise McpConnectionError(
            "`uvx` is not on PATH. Install uv (https://docs.astral.sh/uv/) "
            "or disable the MiniMax MCP via SEASID_MCP_MINIMAX_ENABLED=false."
        )
    base_path = _resolve_base_path()
    env = {
        **os.environ,
        "MINIMAX_API_KEY": api_key,
        "MINIMAX_API_HOST": os.getenv("MINIMAX_API_HOST", "https://api.minimax.io"),
        "MINIMAX_MCP_BASE_PATH": str(base_path),
    }
    try:
        proc = await asyncio.create_subprocess_exec(
            uvx,
            "minimax-coding-plan-mcp",
            "-y",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except FileNotFoundError as exc:
        raise McpConnectionError(f"Could not launch {uvx}: {exc}") from exc
    except Exception as exc:
        raise McpConnectionError(f"Failed to spawn MiniMax MCP: {exc}") from exc

    session = _McpSession(proc, server_name="minimax")
    await session.start()
    try:
        await session.request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": CLIENT_INFO,
            },
        )
    except McpConnectionError:
        await session.close()
        raise

    # `notifications/initialized` is a JSON-RPC notification (no id, no
    # response expected) so we can't use request() — write it directly
    # to stdin and move on.
    try:
        assert proc.stdin is not None
        proc.stdin.write(
            (
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "notifications/initialized",
                        "params": {},
                    }
                )
                + "\n"
            ).encode("utf-8")
        )
        await proc.stdin.drain()
    except Exception:
        # Some servers tolerate a missing initialized notification; log
        # but don't fail the whole boot.
        logger.debug("Could not send notifications/initialized", exc_info=True)

    return session


async def _discover_tools(session: _McpSession) -> list[McpTool]:
    """Ask the subprocess for its tool list and cache it."""
    result = await session.request("tools/list", {})
    raw = result.get("tools") or []
    out: list[McpTool] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        out.append(
            McpTool(
                name=entry.get("name") or "",
                description=entry.get("description") or "",
                input_schema=entry.get("inputSchema") or {"type": "object", "properties": {}},
            )
        )
    return out


async def _boot(api_key: str, key_id: int | None) -> tuple[_McpSession, list[McpTool]]:
    """Idempotently boot a session and cache the discovered tool list."""
    global _session, _tools_cache, _key_id_in_use
    async with _async_lock():
        if (
            _session is not None
            and not _session.closed
            and _key_id_in_use == key_id
            and _tools_cache is not None
        ):
            return _session, _tools_cache
        # Tear down any stale session before respawning.
        if _session is not None:
            try:
                await _session.close()
            except Exception:
                pass
        session = await _spawn_session(api_key)
        try:
            tools = await _discover_tools(session)
        except Exception:
            await session.close()
            raise
        _session = session
        _tools_cache = tools
        _key_id_in_use = key_id
        return session, tools


# We need an asyncio lock, but expose a module-level coroutine lock that
# threads (sync callers) can acquire via run_in_executor if they need to.
_async_lock_inst: asyncio.Lock | None = None


def _async_lock() -> asyncio.Lock:
    global _async_lock_inst
    if _async_lock_inst is None:
        _async_lock_inst = asyncio.Lock()
    return _async_lock_inst


# ── Public API ───────────────────────────────────────────────────────────


async def ensure_booted() -> tuple[_McpSession | None, list[McpTool]]:
    """Boot the MCP if a key is available; return ``(session, tools)``.

    Returns ``(None, [])`` when the MCP is disabled, no key is configured,
    or the subprocess can't be started. The agent loop must treat this
    as "no web tools available" and continue without surfacing an error
    to the user (the LLM will simply not see web_search / web_browse).
    """
    if not _is_enabled():
        return None, []
    # Lazy import to keep this module importable without DB access
    # (useful for unit tests and docs builds).
    try:
        from app.lib import provider_keys
    except Exception as exc:
        logger.debug("provider_keys unavailable; skipping MCP boot: %s", exc)
        return None, []
    try:
        api_key, key_id = provider_keys.resolve_mcp_minimax_key()
    except Exception as exc:
        logger.warning("MCP key resolution failed: %s", exc)
        return None, []
    if not api_key:
        return None, []
    try:
        session, tools = await _boot(api_key, key_id)
    except McpConnectionError as exc:
        logger.warning("MiniMax MCP unavailable: %s", exc)
        if key_id is not None:
            try:
                provider_keys.mark_provider_error(key_id, str(exc))
            except Exception:
                pass
        return None, []
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("Unexpected error booting MiniMax MCP: %s", exc)
        return None, []
    return session, tools


async def get_mcp_tools() -> list[McpTool]:
    """Return the live MCP tool list, booting the subprocess if needed."""
    _, tools = await ensure_booted()
    return tools


async def call_mcp_tool(name: str, arguments: dict) -> str:
    """Dispatch a tool call to the MCP subprocess and return its text.

    Concatenates the ``text`` parts of the response ``content`` array,
    matching the behaviour of the reference TypeScript client. Errors
    come back as plain text so the LLM can read them and recover.
    """
    session, _tools = await ensure_booted()
    if session is None:
        return (
            "Web search is currently unavailable. The MiniMax MCP could not be "
            "started — check that an LLM API key is configured in Settings and "
            "that `uvx` is on PATH."
        )
    try:
        result = await session.request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )
    except McpConnectionError as exc:
        # Mark the session dead so the next call respawns.
        global _session, _tools_cache
        try:
            await session.close()
        except Exception:
            pass
        _session = None
        _tools_cache = None
        return f"Error: MCP tool {name} failed: {exc}"

    if result.get("isError"):
        texts = [
            part.get("text", "")
            for part in (result.get("content") or [])
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return f"Error from MCP tool {name}: {''.join(texts) or 'unknown error'}"
    parts = result.get("content") or []
    texts: list[str] = []
    for part in parts:
        if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str):
            texts.append(part["text"])
    if texts:
        return "\n".join(texts)
    return json.dumps(parts)


async def shutdown() -> None:
    """Close the cached subprocess. Call from FastAPI lifespan teardown."""
    global _session, _tools_cache
    if _session is None:
        return
    try:
        await _session.close()
    finally:
        _session = None
        _tools_cache = None


def invalidate_cache() -> None:
    """Drop the cached session so the next call respawns with a fresh key."""
    global _session, _tools_cache
    _session = None
    _tools_cache = None


def cached_key_id() -> int | None:
    """Return the DB key id currently powering the MCP, or None for env."""
    return _key_id_in_use
