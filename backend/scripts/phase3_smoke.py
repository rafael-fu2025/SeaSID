"""Phase 3 smoke test — verify tier selection + version surface."""
import time
from app.api.services import get_forecast, invalidate_forecast_cache
from app.lib.model import load_best, selected_tier, get_model_type
from app.lib.freshness import model_version

# Clear caches
invalidate_forecast_cache(None)
import app.lib.model as M
M._cached_bundle = None
M._selected_tier = None
M._selection_reason = None

print("=" * 70)
print("PHASE 3 SMOKE: tier selection on dashboard forecast")
print("=" * 70)

bundle = load_best()
tier, reason = selected_tier()
print(f"\nModel tier chosen at load:")
print(f"  tier: {tier}")
print(f"  reason: {reason}")
print(f"  bundle loaded: {bundle is not None}")
print(f"  model_version string: {model_version(bundle)}")

# Hit the dashboard endpoint
print(f"\n--- Dashboard forecast (12h horizon) ---")
t0 = time.perf_counter()
result = get_forecast("dauin_muck", hours=12)
elapsed_ms = (time.perf_counter() - t0) * 1000

print(f"  elapsed: {elapsed_ms:.0f} ms")
print(f"  forecast_source: {result.get('forecast_source')}")
print(f"  model_version: {result.get('model_version')}")
print(f"  fallback_hours: {result.get('fallback_hours')} / 12")
print(f"  optimal_window: {result['optimal_window']}")
print(f"  p_bad range: [{min(h['p_bad'] for h in result['hours'])}, "
      f"{max(h['p_bad'] for h in result['hours'])}]")

# Warm call
t0 = time.perf_counter()
get_forecast("dauin_muck", hours=12)
warm_ms = (time.perf_counter() - t0) * 1000
print(f"\n  warm (cache hit): {warm_ms:.2f} ms")