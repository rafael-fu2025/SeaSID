# SeaSID — thin wrapper around `python dev.py` (the single source of truth).
#
# On Windows (where `make` is usually absent) run the Python commands directly,
# e.g. `python dev.py setup` / `python dev.py doctor`.
#
# Override the interpreter with `make setup PY=python3.12` if needed.

PY ?= python

.PHONY: help setup doctor lint test backend frontend

help:
	@$(PY) dev.py --help

## setup: create venv, install backend+frontend deps, init db, seed sample data
setup:
	$(PY) dev.py setup

## doctor: check runtime versions (Python/Node/npm) and required env vars
doctor:
	$(PY) dev.py doctor

## backend: run the API server with autoreload
backend:
	cd backend && .venv/bin/python -m scripts.run_api --reload

## frontend: run the Vite dev server
frontend:
	cd frontend && npm run dev

## lint: run ruff (backend) and eslint (frontend)
lint:
	cd backend && .venv/bin/python -m ruff check .
	cd frontend && npm run lint

## test: run backend (pytest) and frontend (vitest) suites
test:
	cd backend && .venv/bin/python -m pytest tests/ -q
	cd frontend && npm test
