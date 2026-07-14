"""Phase 1 verification — check that the rule-based fallback kicks in."""
import time
from app.api.services import get_forecast

for site in ("dauin_muck", "apo_reef"):
    t0 = time.perf_counter()
    result = get_forecast(site)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    p_bads = [h["p_bad"] for h in result["hours"]]
    print(f"=== {site} ({elapsed_ms:.0f} ms) ===")
    print(f"  forecast_source: {result.get('forecast_source')}")
    print(f"  fallback_hours: {result.get('fallback_hours')} / 48")
    print(f"  optimal_window: {result['optimal_window']}")
    print(f"  p_bad range: [{min(p_bads)}, {max(p_bads)}]")
    print(f"  p_bad unique: {sorted(set(p_bads))}")
    print(f"  first 3 hours:")
    for h in result["hours"][:3]:
        print(f"    ts={h['ts']} p_bad={h['p_bad']} viz={h['viz_label']} "
              f"current={h['current_risk']} risk={h['risk']} "
              f"source={h['model_used']} degraded={h.get('degraded_reason')}")
    print()