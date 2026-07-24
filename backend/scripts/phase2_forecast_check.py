"""Phase 2 forecast verification — confirm retrained LSTM drives real p_bad values."""
import time
from app.api.services import get_forecast, invalidate_forecast_cache

print("=" * 70)
print("PHASE 2: Forecast after retrained LSTM")
print("=" * 70)

invalidate_forecast_cache(None)

t0 = time.perf_counter()
result = get_forecast("dauin_muck", hours=12)
elapsed_ms = (time.perf_counter() - t0) * 1000

print(f"\n[dauin_muck] cold (12h): {elapsed_ms:.0f} ms")
print(f"  forecast_source: {result.get('forecast_source')}")
print(f"  fallback_hours: {result.get('fallback_hours')} / 12")
print(f"  model_version: {result.get('model_version')}")
print(f"  optimal: {result['optimal_window']}")

p_bads = [h["p_bad"] for h in result["hours"]]
print(f"  p_bad range: [{min(p_bads)}, {max(p_bads)}]")
print(f"  p_bad unique: {sorted(set(p_bads))}")

print("\n  All 12 hours:")
for h in result["hours"]:
    flag = "FALLBACK" if h.get("degraded_reason") else "LSTM"
    print(f"    {h['ts']}  p_bad={h['p_bad']:.3f}  viz={h['viz_label']:>8}  "
          f"current={h['current_risk']:>8}  risk={h['risk']:>10}  [{flag}]")

# Warm call (cache hit)
t0 = time.perf_counter()
get_forecast("dauin_muck", hours=12)
warm_ms = (time.perf_counter() - t0) * 1000
print(f"\n  warm (cache hit): {warm_ms:.2f} ms")
