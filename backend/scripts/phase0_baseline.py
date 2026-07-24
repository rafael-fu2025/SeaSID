"""
Phase 0 baseline capture.

Run with: python -m scripts.phase0_baseline
Writes /tmp/phase0_baseline.json so we can diff before/after each phase.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from app.api.services import get_forecast
from app.lib.model import load_best, get_model_type
from app.lib.freshness import model_version

OUT = Path("/tmp/phase0_baseline.json")


def capture(site_key: str) -> dict:
    bundle = load_best()
    print(f"[{site_key}] model_type={get_model_type(bundle)} n_samples={bundle.get('n_samples') if bundle else 'N/A'}")
    print(f"[{site_key}] model_version={model_version(bundle)}")

    t0 = time.perf_counter()
    result = get_forecast(site_key)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    p_bads = [h["p_bad"] for h in result["hours"]]
    summary = {
        "site_key": site_key,
        "elapsed_ms": round(elapsed_ms, 1),
        "generated_at": result["generated_at"],
        "data_as_of": result["data_as_of"],
        "model_version": result["model_version"],
        "n_hours": len(result["hours"]),
        "p_bad_min": min(p_bads),
        "p_bad_max": max(p_bads),
        "p_bad_mean": round(sum(p_bads) / len(p_bads), 4),
        "p_bad_unique": sorted(set(p_bads)),
        "optimal_window": result["optimal_window"],
        "freshness": result["freshness"],
        "degraded": result["degraded"],
        "first_3_hours": result["hours"][:3],
        "all_hours_compact": [
            {
                "ts": h["ts"],
                "p_bad": h["p_bad"],
                "viz": h["viz_label"],
                "current": h["current_risk"],
                "risk": h["risk"],
            }
            for h in result["hours"]
        ],
    }

    print(f"[{site_key}] elapsed={elapsed_ms:.0f}ms | p_bad range=[{summary['p_bad_min']}, {summary['p_bad_max']}] | unique={summary['p_bad_unique']}")
    print(f"[{site_key}] optimal: {summary['optimal_window']}")
    print(f"[{site_key}] freshness: {[(f['source'], f['status'], f['age_hours']) for f in result['freshness']]}")
    print(f"[{site_key}] degraded: {result['degraded']}")
    return summary


def main() -> None:
    payload = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "sites": {
            "dauin_muck": capture("dauin_muck"),
            "apo_reef": capture("apo_reef"),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    print(f"\nWrote baseline to {OUT}")


if __name__ == "__main__":
    main()