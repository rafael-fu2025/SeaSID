"""Phase 4 performance verification."""
import time
from app.api.services import get_forecast, invalidate_forecast_cache

print("=== Phase 4 performance check ===\n")

# Cold call (cache miss, full pipeline)
invalidate_forecast_cache(None)
t0 = time.perf_counter()
result = get_forecast("dauin_muck", hours=48)
cold_ms = (time.perf_counter() - t0) * 1000
print(f"dauin_muck COLD: {cold_ms:.0f} ms")
print(f"  forecast_source: {result.get('forecast_source')}")
print(f"  fallback_hours: {result.get('fallback_hours')} / 48")
print(f"  p_bad range: [{min(h['p_bad'] for h in result['hours'])}, "
      f"{max(h['p_bad'] for h in result['hours'])}]")
print()

# Warm calls (cache hit)
for i in range(3):
    t0 = time.perf_counter()
    get_forecast("dauin_muck", hours=48)
    warm_ms = (time.perf_counter() - t0) * 1000
    print(f"dauin_muck WARM #{i+1}: {warm_ms:.1f} ms")

print()
# Same for apo_reef
invalidate_forecast_cache(None)
t0 = time.perf_counter()
result = get_forecast("apo_reef", hours=48)
cold_ms = (time.perf_counter() - t0) * 1000
print(f"apo_reef COLD: {cold_ms:.0f} ms")
print(f"  forecast_source: {result.get('forecast_source')}")
print(f"  fallback_hours: {result.get('fallback_hours')} / 48")
print()

for i in range(3):
    t0 = time.perf_counter()
    get_forecast("apo_reef", hours=48)
    warm_ms = (time.perf_counter() - t0) * 1000
    print(f"apo_reef WARM #{i+1}: {warm_ms:.1f} ms")