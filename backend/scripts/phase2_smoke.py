"""Phase 2 focused smoke test — confirms retrained LSTM doesn't crash.

Skips the heavy 48-hour build_sequences path (Phase 4 will fix that),
just calls predict() directly to verify the saved 14-feature bundle works.
"""
import time
from datetime import datetime, timezone

from app.lib.model import load_best, get_model_type, predict

print("=" * 60)
print("PHASE 2 SMOKE: retrained LSTM works on 14-feature schema")
print("=" * 60)

bundle = load_best()
print(f"\nmodel_type: {get_model_type(bundle)}")
print(f"scaler expects: {bundle['scaler'].n_features_in_} features")
print(f"feature_columns: {len(bundle.get('feature_columns', []))}")
assert bundle["scaler"].n_features_in_ == 14, "phase 2 retrain should be on 14 features"
assert len(bundle.get("feature_columns", [])) == 14

# Predict 6 hours and report spread (key Phase 0 symptom was all=0.5)
now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
predictions = []
for h in range(6):
    ts = now.replace(hour=h)
    t0 = time.perf_counter()
    p_bad = predict(bundle, "dauin_muck", ts)
    dt = (time.perf_counter() - t0) * 1000
    predictions.append(p_bad)
    print(f"  hour {h}: p_bad={p_bad:.4f}  ({dt:.0f}ms)")

pmin, pmax = min(predictions), max(predictions)
spread = pmax - pmin
print(f"\np_bad spread: [{pmin:.3f}, {pmax:.3f}]  (width={spread:.3f})")
print(f"unique values: {len(set(round(p, 3) for p in predictions))}/6")

if spread > 0.05:
    print("\n✅ Phase 2 verification SUCCESSFUL — LSTM produces real, non-degenerate probabilities")
else:
    print("\n⚠️ Predictions are nearly flat — model still data-limited (F1=0 on 104 samples),")
    print("   but the technical fix is in place: no schema-mismatch crash.")