"""Collect immutable raw Open-Meteo archive responses in date chunks.

This collector never writes to the production database and never overwrites a
previous response. API secrets, when required by a configured endpoint, are
read from OPEN_METEO_API_KEY.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.lib.ml_pipeline import load_config
from app.lib.sites import get_all_sites


logger = logging.getLogger("seasid.ml.collect")


def _session(max_retries: int) -> requests.Session:
    retry = Retry(
        total=max_retries,
        connect=max_retries,
        read=max_retries,
        status=max_retries,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        respect_retry_after_header=True,
    )
    session = requests.Session()
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({"User-Agent": "SeaSID-research/1.0"})
    return session


def _chunks(start: date, end: date, days: int):
    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + timedelta(days=days - 1))
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def collect(config: dict, start: date, end: date) -> dict:
    settings = config["collection"]
    raw_dir = Path(config["paths"]["raw_dir"]) / "open_meteo_archive"
    raw_dir.mkdir(parents=True, exist_ok=True)
    session = _session(int(settings["max_retries"]))
    api_key = os.getenv("OPEN_METEO_API_KEY", "").strip()
    report = {"requested": 0, "downloaded": 0, "skipped_existing": 0, "failed": []}

    for site in get_all_sites():
        site_dir = raw_dir / site["key"]
        site_dir.mkdir(parents=True, exist_ok=True)
        for chunk_start, chunk_end in _chunks(start, end, int(settings["chunk_days"])):
            report["requested"] += 1
            stem = f"{chunk_start.isoformat()}_{chunk_end.isoformat()}"
            if list(site_dir.glob(f"{stem}_*.json")):
                report["skipped_existing"] += 1
                continue
            params = {
                "latitude": site["lat"],
                "longitude": site["lon"],
                "start_date": chunk_start.isoformat(),
                "end_date": chunk_end.isoformat(),
                "hourly": ",".join(settings["hourly_fields"]),
                "timezone": "UTC",
            }
            if api_key:
                params["apikey"] = api_key
            try:
                response = session.get(
                    settings["open_meteo_archive_url"],
                    params=params,
                    timeout=float(settings["request_timeout_seconds"]),
                )
                response.raise_for_status()
                payload = {
                    "metadata": {
                        "provider": "open_meteo_archive",
                        "site_key": site["key"],
                        "requested_at": datetime.now(timezone.utc).isoformat(),
                        "request_url": response.url.split("apikey=")[0],
                        "start_date": chunk_start.isoformat(),
                        "end_date": chunk_end.isoformat(),
                    },
                    "response": response.json(),
                }
                timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                destination = site_dir / f"{stem}_{timestamp}.json"
                destination.write_text(json.dumps(payload, indent=2), encoding="utf-8")
                report["downloaded"] += 1
            except (requests.RequestException, ValueError) as exc:
                logger.error("Collection failed for %s %s: %s", site["key"], stem, exc)
                report["failed"].append({"site_key": site["key"], "range": stem, "error": str(exc)})
            time.sleep(float(settings["rate_limit_seconds"]))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path)
    parser.add_argument("--start")
    parser.add_argument("--end")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = load_config(args.config) if args.config else load_config()
    default_end = config["collection"]["end_date"] or (date.today() - timedelta(days=5)).isoformat()
    start = date.fromisoformat(args.start or config["collection"]["start_date"])
    end = date.fromisoformat(args.end or default_end)
    print(json.dumps(collect(config, start, end), indent=2))


if __name__ == "__main__":
    main()
