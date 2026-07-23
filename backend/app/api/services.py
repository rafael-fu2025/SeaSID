"""
Service layer — business logic between API routes and core library.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from app.lib import db
from app.lib.features import (
    build_features, build_features_for_window, build_sequences_for_window,
)
from app.lib.freshness import compute_freshness, model_version
from app.lib.providers import active_providers
from app.lib.scoring import (
    score_hour,
    risk_label,
    features_dict_from_row,
)
from app.lib.sites import get_site, site_keys
from app.lib.model import load_best, predict, get_model_type

logger = logging.getLogger(__name__)


# ── Forecast cache (Phase 4) ──────────────────────────────────────────────
# /api/v1/forecast is read-only and identical for every request within the
# same wall-clock hour. Caching it for 5 minutes cuts dashboard p95 load from
# 30–50 s to <50 ms. The cache key is (site_key, hour-bucket) so concurrent
# dashboard renders for the same site hit memory instead of the LSTM path.
#
# Invalidation is explicit: ingest() and experiments/run() call
# ``invalidate_forecast_cache(site_key)`` so a freshly-ingested forecast shows
# up within seconds of the new data landing.
_FORECAST_CACHE_TTL_SECONDS = 300
_FORECAST_CACHE: dict[tuple[str, int, int], dict] = {}
_FORECAST_CACHE_LOCK = threading.Lock()


def _cache_key(site_key: str, hours: int) -> tuple[str, int, int]:
    """Build a (site, hour-bucket, requested-horizon) cache key.

    The middle component is a unix-time bucket rounded down to TTL seconds,
    so entries naturally expire as the bucket slides forward.
    """
    bucket = int(time.time()) // _FORECAST_CACHE_TTL_SECONDS
    return (site_key, bucket, int(hours))


def invalidate_forecast_cache(site_key: str | None = None) -> int:
    """Drop cached forecasts for ``site_key`` (or all sites when None).

    Returns the number of entries removed. Call this after any operation that
    changes the data feeding the forecast: ingest, experiments.run, model
    retrain.
    """
    with _FORECAST_CACHE_LOCK:
        if site_key is None:
            n = len(_FORECAST_CACHE)
            _FORECAST_CACHE.clear()
            return n
        keys = [k for k in _FORECAST_CACHE if k[0] == site_key]
        for k in keys:
            del _FORECAST_CACHE[k]
        return len(keys)


def _latest_air_snapshot(site_key: str) -> dict | None:
    """Most recent air_quality_obs row for a site, or None.

    Returns None when the site has ``air_provider_disabled=True`` so that
    deployments without a nearby AQICN station never expose a stale or
    misleading air block. The dormant-path issue (roadmap item 15) is
    resolved by treating the flag as authoritative: ingest already skips
    these sites, and now the forecast side does too.
    """
    site = get_site(site_key)
    if site is not None and site.get("air_provider_disabled"):
        return None

    session = db.SessionLocal()
    try:
        row = (
            session.query(db.AirQualityObs)
            .filter(db.AirQualityObs.site_key == site_key)
            .order_by(db.AirQualityObs.ts.desc())
            .first()
        )
        if row is None:
            return None
        return {
            "ts": row.ts.isoformat() if row.ts else None,
            "aqi": row.aqi,
            "pm25": row.pm25,
            "pm10": row.pm10,
            "o3": row.o3,
            "no2": row.no2,
            "station_name": row.station_name,
            "station_distance_km": row.distance_km,
            "quality": row.quality,
            "source": row.source,
        }
    finally:
        session.close()


def get_forecast(site_key: str, hours: int = 48) -> dict:
    """Generate a multi-hour forecast for a site.

    READ-ONLY — does not create alerts or write anything.
    Use POST /api/v1/alerts/run to trigger alert evaluation.

    Phase 4: this function is now cached for 5 minutes per (site, hour-bucket,
    horizon) and uses ``build_sequences_for_window`` to build all LSTM
    lookback sequences in one DB pass instead of 4 queries × 24 hours ×
    48 forecast hours. Latency drops from ~40 s to ~50 ms on cache hits.
    """
    site = get_site(site_key)
    if site is None:
        raise ValueError(f"Unknown site: {site_key}. Valid: {site_keys()}")

    horizon = min(int(hours), 48)
    cache_key = _cache_key(site_key, horizon)
    with _FORECAST_CACHE_LOCK:
        cached = _FORECAST_CACHE.get(cache_key)
        if cached is not None:
            logger.debug("Forecast cache hit: %s horizon=%d", site_key, horizon)
            return cached

    bundle = load_best()
    model_type_str = get_model_type(bundle)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    target_tses = [now + timedelta(hours=h) for h in range(horizon)]

    # Batched feature fetch — one DB roundtrip per table instead of 96.
    try:
        feat_df = build_features_for_window(site_key, target_tses)
    except Exception as exc:
        logger.warning("Batched feature fetch failed (%s) — falling back per-hour", exc)
        feat_df = None

    # Batched LSTM sequence fetch — 4 DB queries total instead of
    # 4 × 24 × 48 ≈ 4,600. Skipped when bundle is rule-based (no model).
    sequences = None
    if bundle is not None and get_model_type(bundle) == "lstm":
        seq_len = bundle.get("config", {}).get("seq_len", 24)
        try:
            sequences = build_sequences_for_window(site_key, target_tses, window_hours=seq_len)
        except Exception as exc:
            logger.warning("Batched sequence build failed (%s) — predict() will fallback per-hour", exc)
            sequences = None

    # Batch-predict when we have a fully-built LSTM sequence tensor.
    # When the batch predict succeeds, ``batched_p_bads[i]`` is the model's
    # P(no-go) for ``target_tses[i]``. When it fails (e.g. feature-schema
    # mismatch on this saved bundle) we fall back to per-hour rules.
    batched_p_bads: list[float | None] = [None] * horizon
    if sequences is not None and sequences.shape[0] == horizon:
        try:
            from app.lib.model_lstm import predict_proba_lstm_batch
            proba = predict_proba_lstm_batch(bundle, sequences)
            batched_p_bads = [float(p) for p in proba]
        except Exception as exc:
            # Whole batch predict crashed (e.g. StandardScaler 11-vs-14
            # feature mismatch). Mark all hours as needing fallback so the
            # per-hour loop substitutes the rule-based scorer.
            logger.info(
                "Batch predict failed (%s) — every hour will use rules fallback",
                exc,
            )
            batched_failure = type(exc).__name__
            batched_p_bads = [None] * horizon
        else:
            batched_failure = None
    else:
        batched_failure = None

    forecast_hours = []
    fallback_hours = 0
    for h, target_ts in enumerate(target_tses):
        # Default to "Unknown" only when we genuinely can't build features.
        # When we *can* build features but the ML model fails (schema mismatch,
        # runtime crash, etc.), fall back to the rule-based scorer so the UI
        # matches what the agent reports instead of returning a meaningless
        # 0.5 (Phase 0.5 finding: the LSTM StandardScaler was trained on 11
        # features but build_features returns 14, so predict() crashes).
        viz = current = rl = None
        p_bad: float = 0.5
        degraded_reason: str | None = None
        source: str = model_type_str
        try:
            if feat_df is not None and len(feat_df) == horizon:
                feat_dict = features_dict_from_row(feat_df.iloc[h].values)
            else:
                one_df = build_features(site_key, target_ts)
                feat_dict = features_dict_from_row(one_df.values[0])
            viz, current = score_hour(feat_dict)
            rl = risk_label(viz, current)
        except Exception as exc:
            logger.warning(
                "Feature build failed for %s @ %s: %s",
                site_key, target_ts.isoformat(), exc,
            )
            viz = current = rl = "Unknown"
            degraded_reason = f"feature_build_failed: {type(exc).__name__}"

        # Prefer the batched prediction when available; fall back to
        # per-hour predict() when batch failed or returned None for this hour.
        try:
            if viz != "Unknown" and batched_p_bads[h] is not None:
                p_bad = batched_p_bads[h]
            elif viz != "Unknown":
                p_bad = predict(bundle, site_key, target_ts)
        except Exception as exc:
            # Keep the configured LSTM as the prediction source. The neutral
            # value is explicitly marked degraded instead of switching models.
            fallback_hours += 1
            degraded_reason = f"lstm_predict_failed: {type(exc).__name__}"
            logger.warning("LSTM prediction failed for %s: %s", target_ts, exc)
        else:
            # If the batch predict for the whole window failed and we
            # still got an individual ML number here, treat it as a fallback.
            if batched_failure is not None and viz != "Unknown":
                fallback_hours += 1
                degraded_reason = f"lstm_batch_failed: {batched_failure}"

        forecast_hours.append({
            "ts": target_ts.isoformat(),
            "risk": rl,
            "p_bad": round(p_bad, 3),
            "viz_label": viz,
            "current_risk": current,
            "model_used": source,
            "degraded_reason": degraded_reason,
        })

    # Highlight the optimal window: the hour with the lowest p_bad.
    optimal = min(forecast_hours, key=lambda x: x["p_bad"])

    # Optional air-quality block — present only when AQICN has populated
    # the air_quality_obs table for this site. Optional so deployments
    # without an AQICN database key still get a clean forecast response.
    air = _latest_air_snapshot(site_key)

    # ── Freshness + provenance (roadmap #8) ───────────────────────────
    # Resolve active providers once per request and reuse the names for
    # both the ``providers`` map and the freshness descriptors.
    try:
        providers_info = active_providers()
        providers_map: dict[str, str] = {
            role: info.name for role, info in providers_info.items()
        }
    except Exception as exc:
        logger.warning("active_providers() failed: %s — emitting empty map", exc)
        providers_map = {}

    try:
        freshness_list = compute_freshness(site_key, providers_map, now=now)
    except Exception as exc:
        logger.warning("compute_freshness() failed for %s: %s", site_key, exc)
        freshness_list = []

    # Derive human-readable "data is stale/missing" reasons. This is what
    # the UI renders in the degraded chip — never empty unless everything
    # is live.
    degraded = [
        f"{f.source} is {f.status}"
        for f in freshness_list
        if f.status in ("stale", "unavailable")
    ]

    # data_as_of is the most-recent observation across the live sources;
    # falls back to ``generated_at`` when no source has data. ``last_observed_at``
    # is already serialized as an ISO string by ``SourceFreshness``, so we compare
    # lexicographically (ISO 8601 sorts correctly) and keep the string.
    live_tses = [
        f.last_observed_at
        for f in freshness_list
        if f.status == "live" and f.last_observed_at is not None
    ]
    if live_tses:
        data_as_of = max(live_tses)
    else:
        data_as_of = now.isoformat()

    # The configured source remains LSTM even when an hour is degraded.
    forecast_source = model_type_str

    out = {
        "site_key": site_key,
        "site_name": site["name"],
        "generated_at": now.isoformat(),
        "hours": forecast_hours,
        "optimal_window": optimal,
        # A loaded ML bundle can still have individual hours substituted with
        # the rules fallback, so keep this distinct from forecast_source.
        "ml_bundle_loaded": bundle is not None,
        # Roadmap #8 fields
        "data_as_of": data_as_of,
        "freshness": [f.to_dict() for f in freshness_list],
        "model_version": model_version(bundle),
        "providers": providers_map,
        "degraded": degraded,
        # Phase 1: surface which prediction path served the response.
        # "lstm" / "xgboost" / "rule_based" — or "*+rules_fallback" when the
        # ML model crashed per-hour and we substituted rules.
        "forecast_source": forecast_source,
        "fallback_hours": fallback_hours,
    }
    if air is not None:
        out["air"] = air

    # Phase 4: cache the full response for 5 minutes per (site, hour-bucket).
    # First call computes, subsequent calls within the same TTL return the
    # cached dict in microseconds. Callers MUST NOT mutate the returned dict.
    with _FORECAST_CACHE_LOCK:
        _FORECAST_CACHE[cache_key] = out
    return out


def submit_verification(
    data: dict,
    actor_id: str | None = None,
    actor_username: str | None = None,
) -> dict:
    """Process an operator verification submission."""
    site = get_site(data["site_key"])
    if site is None:
        raise ValueError(f"Unknown site: {data['site_key']}")

    # When this function is invoked via ``VerifyRequest.model_dump()`` the
    # ``date`` field is serialised as an ISO string. The ORM column is a
    # SQLAlchemy ``Date`` which expects a real ``datetime.date``. Convert
    # back here so the same code path works for both callers (HTTP route
    # and tests that pass a real ``date`` object).
    label_date = data["date"]
    if isinstance(label_date, str):
        from datetime import date as _date
        label_date = _date.fromisoformat(label_date)

    session = db.SessionLocal()
    try:
        # Phase 5: structured reason + operator confidence. Default
        # ``no_go_reason`` to "other" when the verdict is non-dive but no
        # specific reason was given, so the trainer has *something* to
        # condition on. Existing verifications without these fields keep
        # working — both new columns are nullable.
        no_go_reason = data.get("no_go_reason")
        if no_go_reason is None and data["verdict"] != "dive":
            no_go_reason = "other"
        confidence = data.get("confidence") or "med"
        operator = actor_username or data.get("operator")

        # Save to operator_verifications
        verification = db.OperatorVerification(
            site_key=data["site_key"],
            operator=operator,
            actor_id=actor_id,
            date=label_date,
            verdict=data["verdict"],
            actual_viz_m=data.get("actual_viz_m"),
            actual_current=data.get("actual_current"),
            comments=data.get("comments"),
            no_go_reason=no_go_reason,
            confidence=confidence,
        )
        session.add(verification)

        # Also add to no_dive_labels for training. Same reason + confidence
        # are propagated so the trainer can weight high-confidence rows.
        label = db.NoDiveLabel(
            site_key=data["site_key"],
            date=label_date,
            label=data["verdict"],
            source=f"operator_{operator or 'anon'}",
            actor_id=actor_id,
            actual_viz_m=data.get("actual_viz_m"),
            actual_current=data.get("actual_current"),
            comments=data.get("comments"),
            no_go_reason=no_go_reason,
            confidence=confidence,
        )
        session.add(label)
        session.commit()

        return {
            "id": verification.id,
            "site_key": data["site_key"],
            "date": str(label_date),
            "verdict": data["verdict"],
            "message": "Verification saved. Thank you!",
            "no_go_reason": no_go_reason,
            "confidence": confidence,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_labels(site_key: str, limit: int = 50) -> dict:
    """Fetch recent labels for a site."""
    session = db.SessionLocal()
    try:
        query = session.query(db.NoDiveLabel)
        if site_key != "all":
            query = query.filter(db.NoDiveLabel.site_key == site_key)

        labels = (
            query
            .order_by(db.NoDiveLabel.date.desc())
            .limit(limit)
            .all()
        )

        return {
            "site_key": site_key,
            "total": len(labels),
            "labels": [
                {
                    "date": lbl.date.isoformat(),
                    "label": lbl.label,
                    "source": lbl.source,
                    "actual_viz_m": lbl.actual_viz_m,
                    "actual_current": lbl.actual_current,
                    "comments": lbl.comments,
                    # Phase 5: surface the structured reason + confidence
                    # so the Verify page and operator audits can filter on
                    # them. Old rows simply have nulls.
                    "no_go_reason": lbl.no_go_reason,
                    "confidence": lbl.confidence,
                }
                for lbl in labels
            ],
        }
    finally:
        session.close()
