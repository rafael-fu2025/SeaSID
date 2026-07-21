"""
Phase 0.5 verification — confirms the timestamp fix works end-to-end.

Captures:
  - Weather freshness after re-ingest (should be 7 days of history)
  - build_features returning real (non-zero) values
  - build_sequence returning real 24h lookback
  - score_hour returning actual viz/current labels (not 'Unknown')

Also surfaces the **schema mismatch bug** discovered during this phase:
the LSTM StandardScaler was trained on 11 features, but build_features
now returns 14 — every predict() call crashes. That crash is why the
dashboard shows 50% / Unknown. Phase 1 will route around it by falling
back to the rule-based scorer.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


from app.lib.db import SessionLocal, WeatherObs, MarineObs, TideObs
from app.lib.features import build_features, build_sequence
from app.lib.scoring import (
    score_hour, risk_label, features_dict_from_row,
    p_bad_from_rules,
)
from app.lib.model import load_best

OUT = Path("/tmp/phase05_verification.json")


def check_db(site_key: str) -> dict:
    s = SessionLocal()
    try:
        w = s.query(WeatherObs).filter(WeatherObs.site_key == site_key).order_by(WeatherObs.ts.asc()).all()
        m = s.query(MarineObs).filter(MarineObs.site_key == site_key).order_by(MarineObs.ts.asc()).all()
        t = s.query(TideObs).filter(TideObs.site_key == site_key).order_by(TideObs.ts.asc()).all()
        return {
            "weather_count": len(w),
            "weather_oldest": w[0].ts.isoformat() if w else None,
            "weather_newest": w[-1].ts.isoformat() if w else None,
            "marine_count": len(m),
            "marine_oldest": m[0].ts.isoformat() if m else None,
            "marine_newest": m[-1].ts.isoformat() if m else None,
            "tide_count": len(t),
            "tide_oldest": t[0].ts.isoformat() if t else None,
            "tide_newest": t[-1].ts.isoformat() if t else None,
        }
    finally:
        s.close()


def score_label(features: dict) -> dict:
    viz, current = score_hour(features)
    rl = risk_label(viz, current)
    return {
        "viz_label": viz,
        "current_risk": current,
        "risk_label": rl,
        "p_bad_rules": p_bad_from_rules(features),
    }


def check_features(site_key: str) -> dict:
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    df = build_features(site_key, now)
    feats = features_dict_from_row(df.values[0])
    feats_rounded = {k: round(float(v), 3) for k, v in feats.items()}
    labels = score_label(feats)

    # Also test sequence (24h lookback for LSTM)
    seq = build_sequence(site_key, now, window_hours=24)
    nonzero_rows = sum(1 for row in seq if any(abs(float(x)) > 0.001 for x in row))

    return {
        "current_hour_features": feats_rounded,
        "current_hour_labels": labels,
        "sequence_shape": list(seq.shape),
        "sequence_nonzero_rows": nonzero_rows,
    }


def check_lstm_schema_bug(site_key: str) -> dict:
    """Surfaced the StandardScaler 11-vs-14 feature mismatch in predict()."""
    bundle = load_best()
    if bundle is None:
        return {"has_bundle": False}
    scaler = bundle.get("scaler")
    expected = scaler.n_features_in_ if scaler is not None else None
    return {
        "has_bundle": True,
        "model_type": bundle.get("model_type"),
        "scaler_expected_features": expected,
        "bundle_feature_columns_count": len(bundle.get("feature_columns", [])),
        "feature_columns": bundle.get("feature_columns"),
    }


def main() -> None:
    sites = ["dauin_muck", "apo_reef"]
    payload = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "sites": {},
        "lstm_schema": check_lstm_schema_bug("dauin_muck"),
    }
    for s in sites:
        payload["sites"][s] = {
            "db_state": check_db(s),
            "feature_check": check_features(s),
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2, default=str)

    # Pretty-print
    print("=" * 72)
    print("PHASE 0.5 VERIFICATION")
    print("=" * 72)
    for site in sites:
        d = payload["sites"][site]
        print(f"\n[{site}] DB STATE")
        for k, v in d["db_state"].items():
            print(f"  {k}: {v}")
        print(f"\n[{site}] FEATURE CHECK")
        fc = d["feature_check"]
        print(f"  current_hour_labels: {fc['current_hour_labels']}")
        print(f"  current_hour_features: {fc['current_hour_features']}")
        print(f"  sequence_shape: {fc['sequence_shape']}, nonzero_rows: {fc['sequence_nonzero_rows']}/24")
    print()
    print("=" * 72)
    print("LSTM SCHEMA CHECK")
    print("=" * 72)
    ls = payload["lstm_schema"]
    if ls.get("has_bundle"):
        print(f"  model_type: {ls['model_type']}")
        print(f"  scaler_expected_features (was trained on): {ls['scaler_expected_features']}")
        print(f"  bundle_feature_columns: {ls['feature_columns']}")
        print()
        if ls["scaler_expected_features"] != 14:
            print("  ⚠️  MISMATCH: predict() will crash → 0.5 fallback")
            print("  → Phase 1 fallback to rule-based scorer fixes the UI symptom.")
            print("  → Phase 2 retrains the LSTM with 14 features so predict() works.")
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()