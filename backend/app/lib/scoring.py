"""
Rule-based baseline scorer (Baseline 1).

Hand-tuned thresholds for cold-start predictions when no ML model is loaded.
Also used to generate synthetic labels for historical weather data expansion.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def score_hour(features: dict) -> tuple[str, str]:
    """
    Return (viz_label, current_risk) based on hand-tuned thresholds.

    viz_label ∈ {"Good", "Moderate", "Poor"}
    current_risk ∈ {"Low", "Moderate", "High"}
    """
    precip_24h = features.get("precip_24h_mm", 0.0)
    precip_48h = features.get("precip_48h_mm", 0.0)
    wind_max = features.get("wind_max_24h_kmh", 0.0)
    wave_max = features.get("wave_max_24h_m", 0.0)
    tide_range = features.get("tide_range_24h_m", 0.0)

    # ── Visibility assessment ──────────────────────────────────────────
    viz_label = "Good"

    if precip_24h > 25 or precip_48h > 40:
        viz_label = "Poor"
    elif precip_24h > 12 or precip_48h > 20:
        viz_label = "Moderate"

    if wind_max > 35:
        viz_label = "Poor"
    elif wind_max > 20 and viz_label == "Good":
        viz_label = "Moderate"

    if wave_max > 2.0 and viz_label != "Poor":
        viz_label = "Moderate"

    # ── Current risk assessment ────────────────────────────────────────
    current_risk = "Low"

    if wind_max > 35:
        current_risk = "High"
    elif wind_max > 20:
        current_risk = "Moderate"

    if tide_range > 1.5:
        current_risk = "High"
    elif tide_range > 1.0 and current_risk == "Low":
        current_risk = "Moderate"

    if wave_max > 2.0:
        current_risk = "High"
    elif wave_max > 1.2 and current_risk == "Low":
        current_risk = "Moderate"

    return viz_label, current_risk


def risk_label(viz_label: str, current_risk: str) -> str:
    """
    Combine viz_label + current_risk into a final risk label.
    Returns one of: "LOW", "MODERATE", "HIGH RISK"
    """
    if viz_label == "Poor" or current_risk == "High":
        return "HIGH RISK"
    elif viz_label == "Moderate" or current_risk == "Moderate":
        return "MODERATE"
    else:
        return "LOW"


def p_bad_from_rules(features: dict) -> float:
    """
    Estimate P(no-go) from rule-based scoring.
    Returns a float in [0, 1] approximating the ML model's p_bad.
    Used as a proxy when no ML model is loaded.
    """
    viz, current = score_hour(features)
    rl = risk_label(viz, current)

    if rl == "HIGH RISK":
        return 0.85
    elif rl == "MODERATE":
        return 0.45
    else:
        return 0.10


def derive_label(actual_viz_m: float, actual_current: str) -> str:
    """
    Derive a ground-truth label from operator observations.

    Returns one of: "dive", "poor_viz", "no_dive"
    """
    if actual_viz_m < 5 or actual_current == "High":
        return "no_dive"
    elif actual_viz_m < 10:
        return "poor_viz"
    else:
        return "dive"


def label_to_binary(label: str) -> int:
    """Convert a label to binary: 1 = no-go (no_dive or poor_viz), 0 = go (dive)."""
    return 0 if label == "dive" else 1


def features_dict_from_row(row: list[float]) -> dict:
    """Convert a feature row (list of 11 floats) to a dict keyed by FEATURE_COLUMNS."""
    from app.lib.features import FEATURE_COLUMNS
    return dict(zip(FEATURE_COLUMNS, row))
