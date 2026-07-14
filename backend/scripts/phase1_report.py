"""Phase 1 verification — capture the post-fix forecast state."""
import json
import time
from pathlib import Path

from app.api.services import get_forecast

OUT = Path("/tmp/phase1_report.json")

payload = {"captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sites": {}}

for site in ("dauin_muck", "apo_reef"):
    t0 = time.perf_counter()
    result = get_forecast(site)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    p_bads = [h["p_bad"] for h in result["hours"]]
    payload["sites"][site] = {
        "elapsed_ms": round(elapsed_ms, 1),
        "forecast_source": result.get("forecast_source"),
        "fallback_hours": result.get("fallback_hours"),
        "n_hours": len(result["hours"]),
        "p_bad_min": min(p_bads),
        "p_bad_max": max(p_bads),
        "p_bad_mean": round(sum(p_bads) / len(p_bads), 4),
        "p_bad_unique": sorted(set(p_bads)),
        "optimal_window": result["optimal_window"],
        "first_3_hours": result["hours"][:3],
        "degraded_top_level": result.get("degraded"),
    }

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w") as f:
    json.dump(payload, f, indent=2, default=str)

print("=" * 70)
print("PHASE 1 REPORT")
print("=" * 70)
for site, d in payload["sites"].items():
    print(f"\n[{site}] {d['elapsed_ms']} ms")
    print(f"  forecast_source: {d['forecast_source']}")
    print(f"  fallback_hours: {d['fallback_hours']} / {d['n_hours']}")
    print(f"  p_bad range: [{d['p_bad_min']}, {d['p_bad_max']}]")
    print(f"  p_bad unique: {d['p_bad_unique']}")
    print(f"  optimal: {d['optimal_window']}")
    print(f"  hours[0]: {d['first_3_hours'][0]}")
print(f"\nWrote {OUT}")