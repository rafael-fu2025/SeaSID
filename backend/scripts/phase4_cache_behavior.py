"""Phase 4 detailed cache behavior test."""
import time
from app.api.services import get_forecast, invalidate_forecast_cache

invalidate_forecast_cache(None)
t0 = time.perf_counter()
r1 = get_forecast('dauin_muck', hours=6)
cold = (time.perf_counter()-t0)*1000
print(f"Cold call (full pipeline, 6h horizon): {cold:.0f} ms")
print(f"  forecast_source: {r1.get('forecast_source')}")

t0 = time.perf_counter()
r2 = get_forecast('dauin_muck', hours=6)
warm = (time.perf_counter()-t0)*1000
print(f"Warm call (cache hit): {warm:.2f} ms")
print(f"  same object: {r1 is r2}")

t0 = time.perf_counter()
r3 = get_forecast('dauin_muck', hours=12)
new_horizon = (time.perf_counter()-t0)*1000
print(f"Different horizon (12h, cache miss): {new_horizon:.0f} ms")
print(f"  n_hours: {len(r3['hours'])}")

invalidate_forecast_cache('dauin_muck')
t0 = time.perf_counter()
r4 = get_forecast('dauin_muck', hours=6)
after_invalidate = (time.perf_counter()-t0)*1000
print(f"After invalidate (cache miss): {after_invalidate:.0f} ms")
print(f"  same object as r1: {r1 is r4}")