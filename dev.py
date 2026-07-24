#!/usr/bin/env python3
"""dev.py - one-command developer setup and health check for SeaSID.

This is the single entry point for going from a clean checkout to a runnable
state, and for diagnosing a broken environment. It uses only the Python
standard library so it can run with the *system* interpreter before the backend
virtual environment exists.

Commands
--------
    python dev.py setup     Create the backend venv, install backend and
                            frontend dependencies, copy .env files, initialize
                            the database, and seed sample history.
    python dev.py doctor    Verify runtime versions (Python/Node/npm) and
                            required environment variables, reporting the
                            specific gap for anything missing.

Runtime versions are pinned in ``backend/.python-version`` and
``frontend/.nvmrc`` and consumed by pyenv / nvm respectively. ``doctor`` treats
those pins as a compatibility floor: a newer runtime passes, an older or
missing one fails with an actionable message.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


# Environment variables that must be defined (and non-empty) for a working setup.
# All of these ship uncommented in the matching .env.example, so a fresh
# `setup` satisfies them; deleting one is reported as a specific gap by doctor.
REQUIRED_BACKEND_ENV = ("OPENAI_MODEL", "SEASID_AUTH_ENABLED", "VITE_API_URL")
REQUIRED_FRONTEND_ENV = ("VITE_API_URL",)


class Ctx:
    """Resolved project paths, rooted at ``--root`` (defaults to this file)."""

    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.backend = self.root / "backend"
        self.frontend = self.root / "frontend"
        self.venv = self.backend / ".venv"

    def venv_python(self) -> Path:
        if os.name == "nt":
            return self.venv / "Scripts" / "python.exe"
        return self.venv / "bin" / "python"


# ── tiny output helpers ──────────────────────────────────────────────────────

def header(title: str) -> None:
    print()
    print(f"=== {title} ===")


def step(msg: str) -> None:
    print(f"  -> {msg}")


def skip(msg: str) -> None:
    print(f"  .. {msg} (skipped)")


def die(msg: str):
    print(f"\nERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _npm_argv(npm_path: str) -> list[str]:
    # npm resolves to npm.cmd on Windows, which CreateProcess cannot launch
    # directly; route it through cmd /c so paths with spaces still work.
    if os.name == "nt":
        return ["cmd", "/c", npm_path]
    return [npm_path]


def run(cmd, cwd: Path | None = None, fatal: bool = True) -> int:
    printable = " ".join(str(c) for c in cmd)
    where = f" (in {cwd})" if cwd else ""
    print(f"     $ {printable}{where}")
    try:
        proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None)
    except FileNotFoundError as exc:
        if fatal:
            die(f"command not found: {cmd[0]} ({exc})")
        return 127
    if proc.returncode != 0 and fatal:
        die(f"command failed ({proc.returncode}): {printable}")
    return proc.returncode


# ── version + env helpers ────────────────────────────────────────────────────

def parse_version(text: str | None):
    # Accepts "3.12", "20" (.nvmrc major-only), or "v25.8.1"; minor defaults to 0.
    m = re.search(r"(\d+)(?:\.(\d+))?", text or "")
    return (int(m.group(1)), int(m.group(2) or 0)) if m else None


def read_pin(path: Path):
    return parse_version(path.read_text(encoding="utf-8")) if path.exists() else None


def node_version():
    exe = shutil.which("node")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True)
    except OSError:
        return None
    return parse_version(out.stdout)


def fmt(v) -> str:
    return f"{v[0]}.{v[1]}" if v else "unknown"


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        values[key.strip()] = val.strip()
    return values


def env_value(file_vals: dict[str, str], key: str) -> str:
    # Process environment overrides the file, matching how the app resolves config.
    return os.environ.get(key) or file_vals.get(key, "")


# ── setup ────────────────────────────────────────────────────────────────────

def ensure_env(example: Path, target: Path) -> None:
    if target.exists():
        skip(f"{target.name} already present in {target.parent.name}/")
        return
    if not example.exists():
        print(f"  !! {example} not found; cannot create {target.name}")
        return
    shutil.copyfile(example, target)
    step(f"created {target.parent.name}/{target.name} from {example.name}")


def warn_runtime_drift(ctx: Ctx) -> None:
    pin = read_pin(ctx.backend / ".python-version")
    active = sys.version_info[:2]
    if pin and active != pin:
        rel = "newer than" if active > pin else "OLDER than"
        print(
            f"  !! active Python {fmt(active)} is {rel} the pinned {fmt(pin)} "
            f"(backend/.python-version); dependencies are verified on {fmt(pin)}"
        )


def cmd_setup(ctx: Ctx) -> None:
    header("SeaSID setup")
    warn_runtime_drift(ctx)

    step("Ensuring .env files")
    ensure_env(ctx.backend / ".env.example", ctx.backend / ".env")
    ensure_env(ctx.frontend / ".env.example", ctx.frontend / ".env")

    if ctx.venv.exists():
        skip("backend/.venv already exists")
    else:
        step("Creating backend virtual environment (backend/.venv)")
        run([sys.executable, "-m", "venv", str(ctx.venv)])

    py = ctx.venv_python()
    if not py.exists():
        die(f"virtual environment python not found at {py}")

    step("Upgrading pip (best-effort)")
    run([str(py), "-m", "pip", "install", "--upgrade", "pip", "--retries", "1", "--timeout", "20"], fatal=False)

    step("Installing backend dependencies")
    run([str(py), "-m", "pip", "install", "-r", str(ctx.backend / "requirements.txt")])

    step("Initializing database")
    run([str(py), "-m", "scripts.init_db"], cwd=ctx.backend)

    step("Seeding sample history")
    run([str(py), "-m", "scripts.seed_history"], cwd=ctx.backend)

    npm = shutil.which("npm")
    if not npm:
        die("npm not found on PATH - install Node.js (see frontend/.nvmrc), "
            "then re-run: python dev.py setup")
    step("Installing frontend dependencies (npm install)")
    run(_npm_argv(npm) + ["install"], cwd=ctx.frontend)

    header("Setup complete")
    print("Next steps:")
    if os.name == "nt":
        print(r"  1. Backend : cd backend; .venv\Scripts\python -m scripts.run_api --reload")
    else:
        print("  1. Backend : cd backend && .venv/bin/python -m scripts.run_api --reload")
    print("  2. Frontend: cd frontend && npm run dev       # http://localhost:5173")
    print("  3. Verify  : python dev.py doctor")


# ── doctor ───────────────────────────────────────────────────────────────────

class Check:
    def __init__(self, name: str, status: str, detail: str):
        self.name = name
        self.status = status  # PASS | WARN | FAIL
        self.detail = detail

    def render(self) -> str:
        return f"  [{self.status:<4}] {self.name:<16} {self.detail}"


def check_python(ctx: Ctx) -> Check:
    pin = read_pin(ctx.backend / ".python-version")
    active = sys.version_info[:2]
    if not pin:
        return Check("Python", "WARN", f"{fmt(active)} active; backend/.python-version missing")
    if active < pin:
        return Check("Python", "FAIL",
                     f"{fmt(active)} active but >= {fmt(pin)} required (backend/.python-version)")
    note = "" if active == pin else f" (pinned {fmt(pin)})"
    return Check("Python", "PASS", f"{fmt(active)} active{note}")


def check_venv(ctx: Ctx) -> Check:
    if not ctx.venv.exists():
        return Check("Backend venv", "FAIL", "backend/.venv missing - run: python dev.py setup")
    ver = None
    cfg = ctx.venv / "pyvenv.cfg"
    if cfg.exists():
        for line in cfg.read_text(encoding="utf-8").splitlines():
            if line.lower().startswith("version"):
                ver = parse_version(line)
                break
    return Check("Backend venv", "PASS", f"present ({fmt(ver)})")


def check_node(ctx: Ctx) -> Check:
    nvmrc = ctx.frontend / ".nvmrc"
    pin = read_pin(nvmrc)
    pin_raw = nvmrc.read_text(encoding="utf-8").strip() if nvmrc.exists() else "unknown"
    ver = node_version()
    if ver is None:
        return Check("Node", "FAIL", "node not found on PATH - install Node.js (see frontend/.nvmrc)")
    if pin and ver[0] < pin[0]:
        return Check("Node", "FAIL",
                     f"{fmt(ver)} active but >= {pin_raw} required (frontend/.nvmrc)")
    note = "" if (pin and ver[0] == pin[0]) else f" (pinned {pin_raw})"
    return Check("Node", "PASS", f"{fmt(ver)} active{note}")


def check_npm() -> Check:
    if not shutil.which("npm"):
        return Check("npm", "FAIL", "npm not found on PATH - install Node.js/npm")
    return Check("npm", "PASS", "available")


def check_env(name: str, target: Path, example: Path, required) -> Check:
    if not target.exists():
        hint = f"copy {example.name} -> {target.name}" if example.exists() else "create the file"
        return Check(name, "FAIL", f"{target.name} missing - {hint} (or run: python dev.py setup)")
    vals = parse_env_file(target)
    missing = [k for k in required if not env_value(vals, k)]
    if missing:
        return Check(name, "FAIL", f"{target.name} missing required var(s): {', '.join(missing)}")
    return Check(name, "PASS", f"{target.name} defines {', '.join(required)}")


def check_frontend_env(ctx: Ctx) -> Check:
    candidates = [ctx.frontend / ".env", ctx.frontend / ".env.local"]
    existing = [p for p in candidates if p.exists()]
    if not existing:
        return Check("Frontend env", "FAIL",
                     "frontend/.env(.local) missing - copy .env.example -> .env")
    vals: dict[str, str] = {}
    for p in existing:
        vals.update(parse_env_file(p))
    missing = [k for k in REQUIRED_FRONTEND_ENV if not env_value(vals, k)]
    if missing:
        return Check("Frontend env", "FAIL", f"{existing[0].name} missing var(s): {', '.join(missing)}")
    return Check("Frontend env", "PASS", f"{existing[0].name} defines {', '.join(REQUIRED_FRONTEND_ENV)}")


def cmd_doctor(ctx: Ctx) -> None:
    header("SeaSID doctor")
    checks = [
        check_python(ctx),
        check_venv(ctx),
        check_node(ctx),
        check_npm(),
        check_env("Backend .env", ctx.backend / ".env", ctx.backend / ".env.example", REQUIRED_BACKEND_ENV),
        check_frontend_env(ctx),
    ]
    for c in checks:
        print(c.render())
    print()
    failed = [c for c in checks if c.status == "FAIL"]
    if failed:
        print(f"doctor: {len(failed)} problem(s) found - resolve the FAIL item(s) above.")
        sys.exit(1)
    warned = [c for c in checks if c.status == "WARN"]
    suffix = f" ({len(warned)} warning(s))" if warned else ""
    print(f"doctor: all required checks passed{suffix}.")


# ── entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(prog="dev.py", description="SeaSID setup & doctor")
    sub = parser.add_subparsers(dest="command", required=True)
    commands = (
        ("setup", "create venv, install deps, init db, seed sample history"),
        ("doctor", "check runtime versions and required env vars"),
    )
    for name, help_text in commands:
        p = sub.add_parser(name, help=help_text)
        p.add_argument(
            "--root",
            default=str(Path(__file__).resolve().parent),
            help="project root (defaults to this file's directory)",
        )
    args = parser.parse_args()

    ctx = Ctx(Path(args.root))
    if args.command == "setup":
        cmd_setup(ctx)
    elif args.command == "doctor":
        cmd_doctor(ctx)


if __name__ == "__main__":
    main()
