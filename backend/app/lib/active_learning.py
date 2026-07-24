"""
Phase 8 — Active-learning suggestion engine.

The principle: rather than asking operators to label *every* historical
day, surface the days whose label is most likely to reduce model
uncertainty. The classic measure is *binary entropy*: a model that says
P(no-go)=0.5 is maximally uncertain about that day (entropy = 1 bit),
whereas P=0.05 or P=0.95 are essentially decided (entropy ≈ 0.29 bits).

For each unlabeled past date in a 7-day lookback window we:

1. Replay the model (``predict()``) at noon UTC for that date to get the
   raw ``p_bad`` (already calibrated by Phase 7).
2. Compute ``uncertainty = -p*log(p) - (1-p)*log(1-p)`` (binary entropy).
3. Filter out dates that already have an operator verification
   (``OperatorVerification`` or ``NoDiveLabel`` with high confidence).
4. Filter out dates whose entropy is below the threshold (0.65 ≈ p in
   [0.05, 0.95]); these are "model is confident, no need to ask".
5. Sort by entropy descending, then by date ascending; return the top N.

The dashboard calls ``suggest_active_labels(site_key, days=7, top_n=3)``
once per render and surfaces the top suggestion as a nudge. When the
operator confirms or denies via the existing ``/verify`` endpoint, the
nudge is dismissed automatically (because the date now has a label).

Why a *band* filter rather than the strictest possible entropy cutoff:
operators are humans, not annotators. Showing "the model says 0.51 for
Tuesday — was that right?" is more actionable than "the model says 0.998
for Tuesday" (already confident) or "the model says 0.01 for Tuesday"
(also confident). The band [0.35, 0.65] is the "model is on the fence"
sweet spot.

Confidence of historical data: the more confident *and* correct the
current model, the less value an operator's confirmation adds. So we
*prefer* dates where the model is uncertain over dates where the model
is confidently wrong (the latter are interesting but rarer).
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta, timezone

from app.lib.db import NoDiveLabel, OperatorVerification
from app.lib.features import build_features
from app.lib.model import load_best, predict, get_calibrator
from app.lib.scoring import features_dict_from_row, p_bad_from_rules
from app.lib.sites import get_site

logger = logging.getLogger(__name__)


# ── Configuration ──────────────────────────────────────────────────────────

# Days back from "today" to scan for unlabeled past dates
DEFAULT_LOOKBACK_DAYS = 7

# Number of suggestions returned per request
DEFAULT_TOP_N = 3

# Uncertainty band — only nudge on p_bad in this range
UNCERTAINTY_LOW = 0.35
UNCERTAINTY_HIGH = 0.65

# Replay hour: we use noon UTC so the 24h lookback window straddles
# the natural noon-to-noon dive-day cycle
REPLAY_HOUR_UTC = 12


@dataclass
class ActiveLearningSuggestion:
    """One candidate date where an operator verification is most valuable."""
    site_key: str
    date: str           # ISO date
    p_bad: float        # raw calibrated P(no-go)
    uncertainty: float  # binary entropy in bits
    model_source: str   # which path served the prediction
    rank: int           # 1-based rank within the response
    reason: str         # human-readable explanation of why this date is on the queue


# ── Uncertainty math ───────────────────────────────────────────────────────

def binary_entropy(p: float) -> float:
    """Binary entropy in bits: ``-p*log2(p) - (1-p)*log2(1-p)``.

    Returns 0 for p=0 or p=1 (no uncertainty), 1 for p=0.5 (max
    uncertainty). Used to score how much a label would teach the model.
    """
    p = max(1e-9, min(1 - 1e-9, p))
    return -p * math.log2(p) - (1 - p) * math.log2(1 - p)


def in_uncertainty_band(p: float) -> bool:
    """True when p_bad is in the [0.35, 0.65] "model is on the fence" band."""
    return UNCERTAINTY_LOW <= p <= UNCERTAINTY_HIGH


# ── Lookup helpers ─────────────────────────────────────────────────────────

def _already_labeled(site_key: str, day: date) -> bool:
    """True if any operator verification OR high-confidence NoDiveLabel
    already exists for ``(site_key, day)``.

    High-confidence (``confidence='high'``) labels are treated as
    operator-grade for the purpose of this filter, so the system stops
    re-asking about dates that the operator already confirmed.
    """
    # Look up SessionLocal at call time so tests can monkeypatch the
    # db module and route us to a temp engine.
    from app.lib import db as db_mod
    SessionLocal = db_mod.SessionLocal
    sess = SessionLocal()
    try:
        # OperatorVerification is the source of truth — if a human
        # already confirmed a date, we don't ask again.
        opv = sess.query(OperatorVerification).filter(
            OperatorVerification.site_key == site_key,
            OperatorVerification.date == day,
        ).first()
        if opv is not None:
            return True

        # A "high" confidence NoDiveLabel (e.g. operator-graded scraper
        # output or a strongly-classified weather-only label) is also
        # considered authoritative.
        hi = sess.query(NoDiveLabel).filter(
            NoDiveLabel.site_key == site_key,
            NoDiveLabel.date == day,
            NoDiveLabel.confidence == "high",
        ).first()
        if hi is not None:
            return True
        return False
    finally:
        sess.close()


# ── Replay + score ────────────────────────────────────────────────────────

def _replay_p_bad(site_key: str, day: date) -> tuple[float, str] | None:
    """Replay the production model path for ``(site_key, day)``.

    Returns ``(p_bad, source)`` or ``None`` when features can't be built
    (e.g. no weather data ingested for that date).
    """
    target_ts = datetime(day.year, day.month, day.day, REPLAY_HOUR_UTC, tzinfo=timezone.utc)
    bundle = load_best()
    try:
        p = predict(bundle, site_key, target_ts)
    except Exception as exc:
        # Predict crashed (e.g. feature-schema mismatch) — fall back to
        # the rule-based scorer for this date so we still surface an
        # actionable suggestion. The model_source flag tells the UI
        # what produced the number.
        try:
            feat_df = build_features(site_key, target_ts)
            feat_dict = features_dict_from_row(feat_df.values[0])
            p = p_bad_from_rules(feat_dict)
            return float(p), "rules_fallback"
        except Exception:
            logger.debug("Replay %s/%s failed: %s", site_key, day, exc)
            return None

    # Match services.py semantics: lstm / xgboost / rule_based
    if bundle is None:
        return float(p), "rule_based"
    mt = bundle.get("model_type", "rule_based")
    return float(p), mt


# ── Main entry point ──────────────────────────────────────────────────────

def suggest_active_labels(
    site_key: str,
    *,
    days: int = DEFAULT_LOOKBACK_DAYS,
    top_n: int = DEFAULT_TOP_N,
) -> list[dict]:
    """Return up to ``top_n`` suggestions for ``site_key``.

    The list is ordered by descending uncertainty (the most-uncertain
    past date comes first). Each suggestion includes enough context for
    the UI to render an actionable nudge.
    """
    if get_site(site_key) is None:
        return []

    today = datetime.now(timezone.utc).date()
    candidates: list[ActiveLearningSuggestion] = []

    for offset in range(1, days + 1):
        day = today - timedelta(days=offset)
        # Skip already-labeled days — we don't want to re-ask.
        if _already_labeled(site_key, day):
            continue
        replay = _replay_p_bad(site_key, day)
        if replay is None:
            continue
        p_bad, source = replay
        ent = binary_entropy(p_bad)
        if not in_uncertainty_band(p_bad):
            continue
        reason = (
            f"model said {p_bad:.0%} no-go on {day.isoformat()} — "
            f"in the {UNCERTAINTY_LOW:.0%}-{UNCERTAINTY_HIGH:.0%} "
            f"uncertainty band, so a confirmation teaches the most"
        )
        candidates.append(ActiveLearningSuggestion(
            site_key=site_key,
            date=day.isoformat(),
            p_bad=float(p_bad),
            uncertainty=float(ent),
            model_source=source,
            rank=0,  # filled in after sort
            reason=reason,
        ))

    # Sort by uncertainty descending (most teaching first), tie-break
    # by date ascending (oldest first — older dates are more stable).
    candidates.sort(key=lambda c: (-c.uncertainty, c.date))

    # Apply top_n + assign ranks.
    out: list[dict] = []
    for i, c in enumerate(candidates[:top_n], start=1):
        c.rank = i
        out.append(asdict(c))

    logger.info(
        "Active learning: %s -> %d unlabeled past dates, %d in band, returning top %d",
        site_key, days, len(candidates), len(out),
    )
    return out


def active_learning_summary() -> dict:
    """Cross-site snapshot used by the Settings/Inspector panel.

    Returns total suggestions across all sites + per-site counts.
    """
    from app.lib.sites import site_keys
    out = {
        "uncertainty_band": [UNCERTAINTY_LOW, UNCERTAINTY_HIGH],
        "lookback_days": DEFAULT_LOOKBACK_DAYS,
        "top_n": DEFAULT_TOP_N,
        "calibrator_method": get_calibrator().method,
        "per_site": {},
        "total": 0,
    }
    for sk in site_keys():
        suggestions = suggest_active_labels(sk, top_n=DEFAULT_TOP_N)
        out["per_site"][sk] = len(suggestions)
        out["total"] += len(suggestions)
    return out