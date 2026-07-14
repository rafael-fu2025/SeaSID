"""Phase 1 detail inspection."""
import time
t0 = time.perf_counter()
from app.api.services import get_forecast
result = get_forecast('dauin_muck')
elapsed_ms = (time.perf_counter() - t0) * 1000
print(f"elapsed: {elapsed_ms:.0f} ms")
print(f"forecast_source: {result.get('forecast_source')}")
print(f"fallback_hours: {result.get('fallback_hours')} / 48")
print()
print("hours[0]:", result['hours'][0])
print("hours[10]:", result['hours'][10])
print("hours[24]:", result['hours'][24])
print()
print("optimal_window:", result['optimal_window'])
print()
# Compare to agent's output
from app.lib.scoring import score_hour, risk_label, p_bad_from_rules, features_dict_from_row
from app.lib.features import build_features
from datetime import datetime, timezone
now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
df = build_features('dauin_muck', now)
fd = features_dict_from_row(df.values[0])
viz, current = score_hour(fd)
rl = risk_label(viz, current)
p_bad = p_bad_from_rules(fd)
print(f"agent-equivalent rule output for now: viz={viz} current={current} risk={rl} p_bad={p_bad:.3f}")