"""Phase 4 performance report — captures before/after latency."""
import json
import time
from pathlib import Path

from app.api.services import get_forecast, invalidate_forecast_cache

OUT = Path("/tmp/phase4_report.json")

results = {"captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sites": {}}

for site in ("dauin_muck", "apo_reef"):
    invalidate_forecast_cache(None)
    cold_times = []
    for h in (48, 24, 12, 6):
        invalidate_forecast_cache(site)
        t0 = time.perf_counter()
        get_forecast(site, hours=h)
        cold_times.append({"horizon": h, "ms": round((time.perf_counter() - t0) * 1000, 1)})
    # Warm calls for each horizon
    warm_times = []
    for h in (48, 24, 12, 6):
        invalidate_forecast_cache(site)
        get_forecast(site, hours=h)  # warm cache
        t0 = time.perf_counter()
        get_forecast(site, hours=h)
        warm_times.append({"horizon": h, "ms": round((time.perf_counter() - t0) * 1000, 3)})

    results["sites"][site] = {"cold": cold_times, "warm": warm_times}

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w") as f:
    json.dump(results, f, indent=2)

print("=" * 70)
print("PHASE 4 PERFORMANCE REPORT")
print("=" * 70)
for site, data in results["sites"].items():
    print(f"\n[{site}]")
    print(f"  {'horizon':>8} | {'cold ms':>10} | {'warm ms':>10}")
    print(f"  {'-'*8} | {'-'*10} | {'-'*10}")
    for c, w in zip(data["cold"], data["warm"]):
        speedup = c["ms"] / max(w["ms"], 0.01)
        print(f"  {c['horizon']:>8} | {c['ms']:>10.0f} | {w['ms']:>10.3f}  ({speedup:.0f}x faster)")
print(f"\nWrote {OUT}")