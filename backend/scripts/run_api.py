"""
scripts/run_api.py — Start the FastAPI server with uvicorn.

Usage:
    python -m scripts.run_api
    python -m scripts.run_api --port 8000
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main():
    # On Windows, the default ProactorEventLoop fails on Python 3.14 because
    # its self-pipe creation (socket.socketpair()) raises WinError 10013
    # (WSAEACCES) on some hosts. Force SelectorEventLoop which doesn't
    # need the self-pipe. Must run before uvicorn spins up the loop.
    if sys.platform == "win32":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except AttributeError:
            # Older Python without selector policy; fall back to default.
            pass

    parser = argparse.ArgumentParser(description="Start SeaSID API server")
    parser.add_argument("--host", default="0.0.0.0", help="Host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    args = parser.parse_args()

    import uvicorn
    uvicorn.run(
        "app.api.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
