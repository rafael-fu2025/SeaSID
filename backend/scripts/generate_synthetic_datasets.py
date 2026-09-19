"""
scripts/generate_synthetic_datasets.py — Physics-based synthetic data generator.

Why this exists
---------------
The LSTM (and XGBoost/GRU) collapse to near-random accuracy because the only
labels available were ``synthetic_rule`` rows built on top of *sparse, flat*
``weather_obs``. The 24-hour sequences the LSTM consumes therefore carried
almost no temporal signal, and there were only ~100 heavily-imbalanced
samples. The rule baseline meanwhile scores a perfect 1.000 — a tell-tale
label-leakage artifact, since the labels are themselves rule outputs.

This generator fixes the data, not the model. It synthesises **continuous,
diverse, hourly** weather + tide + marine time-series across several realistic
climate regimes for Dauin & Apo Island, Philippines, then derives labels from
the same rule scorer used in production. Because the hourly series now have
genuine diurnal structure (sea-breeze wind peaks, afternoon convective rain,
mixed semi-diurnal tides, wind-coupled waves) and span calm→storm regimes, the
LSTM sequences finally carry learnable signal and the classes are balanced.

Design notes
------------
* Writes hourly ``weather_obs`` + ``marine_obs`` + ``tide_obs`` and daily
  ``no_dive_labels`` straight into the WAL-mode SQLite DB, honouring every
  ``UniqueConstraint`` via ``on_conflict_do_nothing`` (never overwrites real
  or previously-ingested rows).
* Air quality is intentionally **not** generated: both sites set
  ``air_provider_disabled=True``, so features 12/13 (aqi/pm25) fall back to
  climatological defaults at inference. Generating varied air data would create
  a train/serve skew that hurts real accuracy — so we keep production parity.
* Every synthetic row is tagged ``source="synthetic_scenario"`` so it is
  distinguishable from ``seed`` / ``synthetic_rule`` / operator data and can be
  wiped with ``--clear`` for a clean re-generation.
* Each scenario regime is also exported to ``data/synthetic/<scenario>.csv`` in
  the same daily schema as ``pagasa_seed.csv`` — these per-regime files are the
  "multiple synthetic datasets" and double as reproducible, inspectable
  artifacts alongside a ``manifest.json``.

Usage
-----
    # Default: 180 days x 2 sites of continuous hourly data + labels
    python -m scripts.generate_synthetic_datasets

    # Reproducible, wipe prior synthetic_scenario data first, 365 days
    python -m scripts.generate_synthetic_datasets --days 365 --seed 7 --clear

    # Preview counts without touching the DB
    python -m scripts.generate_synthetic_datasets --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

from app.lib import db as _db_mod
from app.lib.db import init_db
from app.lib.features import FEATURE_COLUMNS, build_features
from app.lib.scoring import risk_label, score_hour
from app.lib.sites import get_all_sites

SYNTHETIC_SOURCE = "synthetic_scenario"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SYNTHETIC_DIR = DATA_DIR / "synthetic"

# Lead-in days generated before the first labelled day so the earliest label's
# 48h weather / 24h tide lookback windows are always fully populated.
PAD_DAYS = 3


# ── Climate regimes ─────────────────────────────────────────────────────────
# Each regime is a distribution of daily-mean drivers. Hourly structure
# (diurnal sea-breeze, afternoon convection) is layered on top per hour. Values
# are tuned for tropical Visayas dive sites and to span all three label classes
# (dive / poor_viz / no_dive) once run through the rule scorer.
SCENARIOS: dict[str, dict] = {
    "calm_dry": {
        "weight": 0.44,
        "wind_base_kmh": (2.0, 7.0),        # daily-mean 10m wind range
        "gust_factor": (1.15, 1.35),        # wind_max = mean * gust
        "rain_prob": 0.04,                  # P(any measurable rain that day)
        "rain_day_mm": (0.0, 3.0),          # total daily rain when it rains
        "swell_base_m": (0.12, 0.35),       # background swell height
        "wave_period_s": (5.0, 8.0),
        "sea_temp_c": (28.5, 30.0),
        "confidence": "high",
    },
    "fair": {
        "weight": 0.20,
        "wind_base_kmh": (5.0, 10.0),
        "gust_factor": (1.2, 1.38),
        "rain_prob": 0.18,
        "rain_day_mm": (1.0, 9.0),
        "swell_base_m": (0.25, 0.5),
        "wave_period_s": (5.0, 8.0),
        "sea_temp_c": (28.0, 29.5),
        "confidence": "med",
    },
    "breezy": {
        "weight": 0.10,
        "wind_base_kmh": (15.0, 22.0),
        "gust_factor": (1.3, 1.5),
        "rain_prob": 0.3,
        "rain_day_mm": (2.0, 16.0),
        "swell_base_m": (0.6, 1.0),
        "wave_period_s": (6.0, 9.0),
        "sea_temp_c": (27.5, 29.0),
        "confidence": "med",
    },
    "rainy_habagat": {
        "weight": 0.07,
        "wind_base_kmh": (13.0, 20.0),
        "gust_factor": (1.3, 1.5),
        "rain_prob": 0.85,
        "rain_day_mm": (16.0, 55.0),        # southwest-monsoon soaking
        "swell_base_m": (0.7, 1.2),
        "wave_period_s": (6.0, 9.0),
        "sea_temp_c": (27.0, 28.5),
        "confidence": "med",
    },
    "squall": {
        "weight": 0.05,
        "wind_base_kmh": (15.0, 22.0),
        "gust_factor": (1.6, 2.0),          # sharp afternoon gust front
        "rain_prob": 0.95,
        "rain_day_mm": (30.0, 70.0),        # dumped in a 2-4h burst
        "swell_base_m": (0.9, 1.5),
        "wave_period_s": (5.0, 8.0),
        "sea_temp_c": (27.0, 28.5),
        "burst": True,                      # concentrate rain/wind in afternoon
        "confidence": "high",
    },
    "tropical_storm": {
        "weight": 0.05,
        "wind_base_kmh": (38.0, 62.0),
        "gust_factor": (1.4, 1.7),
        "rain_prob": 1.0,
        "rain_day_mm": (60.0, 140.0),
        "swell_base_m": (2.0, 3.8),
        "wave_period_s": (8.0, 12.0),
        "sea_temp_c": (26.5, 28.0),
        "confidence": "high",
    },
    "post_storm": {
        "weight": 0.06,
        "wind_base_kmh": (11.0, 18.0),
        "gust_factor": (1.3, 1.5),
        "rain_prob": 0.4,
        "rain_day_mm": (2.0, 14.0),
        "swell_base_m": (0.7, 1.3),         # residual long-period swell
        "wave_period_s": (9.0, 13.0),
        "sea_temp_c": (27.0, 28.5),
        "confidence": "med",
    },
}


def _u(rng: np.random.Generator, lo_hi: tuple[float, float]) -> float:
    """Uniform draw from an inclusive (lo, hi) tuple."""
    lo, hi = lo_hi
    return float(rng.uniform(lo, hi))


def _assign_daily_scenarios(
    rng: np.random.Generator,
    n_days: int,
) -> list[str]:
    """Assign a regime to each day with weather-like persistence.

    Real weather persists: a stormy day is more likely followed by another
    disturbed day than by a calm one. We model this as a weighted random walk —
    each day either keeps the previous regime (persistence) or resamples from
    the base weights — so the generated series has realistic multi-day spells
    rather than i.i.d. noise.
    """
    names = list(SCENARIOS.keys())
    weights = np.array([SCENARIOS[n]["weight"] for n in names], dtype=float)
    weights /= weights.sum()

    persistence = 0.68  # P(carry yesterday's regime forward)
    out: list[str] = []
    prev: str | None = None
    for _ in range(n_days):
        if prev is not None and rng.random() < persistence:
            out.append(prev)
        else:
            prev = str(rng.choice(names, p=weights))
            out.append(prev)
    return out


def _hourly_series_for_day(
    rng: np.random.Generator,
    scenario: str,
    day_index: int,
    site_key: str,
) -> dict[str, list[float]]:
    """Generate 24 hourly driver values for one site-day.

    Returns dict of 24-length lists keyed by driver name. Diurnal structure:
    * wind — sea-breeze peak ~14:00 local layered on the daily-mean base
    * rain — convective afternoon bias (or a sharp burst for squalls)
    * tide — mixed semi-diurnal (M2 + K1) with a spring/neap envelope
    * waves — coupled to wind plus the regime's background swell
    """
    cfg = SCENARIOS[scenario]
    wind_base = _u(rng, cfg["wind_base_kmh"])
    gust = _u(rng, cfg["gust_factor"])
    swell = _u(rng, cfg["swell_base_m"])
    period = _u(rng, cfg["wave_period_s"])
    sea_temp = _u(rng, cfg["sea_temp_c"])
    burst = cfg.get("burst", False)

    # Does it rain today, and how much total?
    rains = rng.random() < cfg["rain_prob"]
    day_rain = _u(rng, cfg["rain_day_mm"]) if rains else 0.0

    # Rain hour-weights: squall dumps into a 3h afternoon window; otherwise a
    # broad afternoon-convection bias.
    if burst:
        centre = int(rng.integers(13, 17))
        rain_w = np.array([
            math.exp(-((h - centre) ** 2) / 2.0) for h in range(24)
        ])
    else:
        rain_w = np.array([
            0.4 + max(0.0, math.sin(math.pi * (h - 8) / 14)) for h in range(24)
        ])
    rain_w = rain_w / rain_w.sum() if rain_w.sum() > 0 else np.ones(24) / 24
    hourly_rain = day_rain * rain_w
    # Add mild multiplicative jitter without changing the daily total much.
    jitter = rng.uniform(0.7, 1.3, size=24)
    hourly_rain = hourly_rain * jitter

    # Tide constituents — Apo Island's channel sees stronger tidal streams, so
    # give it a larger semi-diurnal amplitude (drives current-risk labels).
    amp_scale = 1.25 if site_key == "apo_reef" else 1.0
    spring = 1.0 + 0.35 * math.sin(2 * math.pi * day_index / 14.77)
    m2_phase = rng.uniform(0, 2 * math.pi) if day_index == 0 else 0.0

    precip, wmean, wmax, wave, tide, wperiod, stemp = [], [], [], [], [], [], []
    scur, cspd, cdir = [], [], []
    for h in range(24):
        abs_hour = day_index * 24 + h
        # Wind: base + diurnal sea-breeze (peak mid-afternoon) + noise.
        breeze = max(0.0, math.sin(math.pi * (h - 6) / 14))
        gust_kick = 0.0
        if burst and abs(h - (centre if burst else 14)) <= 2:
            gust_kick = _u(rng, (10.0, 22.0))
        mean_w = wind_base + 2.5 * breeze + gust_kick + rng.normal(0, 1.2)
        mean_w = max(1.0, mean_w)
        max_w = mean_w * gust + rng.normal(0, 1.0)
        max_w = max(mean_w, max_w)

        # Tide height (m): mixed semi-diurnal, spring/neap envelope. Amplitudes
        # are tuned so the 24h tide range mostly sits below the rule's 1.0 m
        # "moderate" and 1.5 m "high" current thresholds, with spring tides (and
        # Apo's channel) occasionally reaching them.
        m2 = 0.26 * amp_scale * math.sin(2 * math.pi * abs_hour / 12.42 + m2_phase)
        k1 = 0.15 * math.sin(2 * math.pi * abs_hour / 23.93)
        height = 1.15 + spring * m2 + k1 + rng.normal(0, 0.02)

        # Waves: wind-sea coupling + background swell.
        wv = 0.038 * max_w + swell + rng.normal(0, 0.07)
        wv = max(0.1, wv)

        # Currents (m/s): rise with tidal flow rate and wind.
        flow = abs(math.cos(2 * math.pi * abs_hour / 12.42)) * amp_scale
        cur = 0.15 + 0.55 * flow + 0.004 * max_w + rng.normal(0, 0.03)
        cur = max(0.02, cur)

        precip.append(round(max(0.0, hourly_rain[h]), 3))
        wmean.append(round(mean_w, 2))
        wmax.append(round(max_w, 2))
        wave.append(round(wv, 3))
        tide.append(round(height, 3))
        wperiod.append(round(period + rng.normal(0, 0.4), 2))
        stemp.append(round(sea_temp + 0.4 * math.sin(math.pi * (h - 9) / 12)
                           + rng.normal(0, 0.1), 2))
        scur.append(round(wv * 0.6, 3))
        cspd.append(round(cur, 3))
        cdir.append(round(float(rng.uniform(0, 360)), 1))

    return {
        "precip_mm": precip,
        "wind_mean_kmh": wmean,
        "wind_max_kmh": wmax,
        "wave_max_m": wave,
        "tide_m": tide,
        "wave_period_s": wperiod,
        "sea_temp_c": stemp,
        "swell_m": scur,
        "current_speed_ms": cspd,
        "current_direction_deg": cdir,
    }


def _no_go_reason(viz: str, curr: str, feat: dict) -> str | None:
    """Map the rule verdict + drivers to a structured no_go_reason code."""
    if viz != "Poor" and curr not in ("High", "Moderate"):
        return None
    if curr == "High":
        if feat["tide_range_24h_m"] > 1.5:
            return "current"
        if feat["wave_max_24h_m"] > 2.0:
            return "swell"
        return "weather"
    if viz == "Poor":
        return "weather"
    # Moderate band.
    if feat["precip_24h_mm"] > 12 or feat["wind_max_24h_kmh"] > 20:
        return "weather"
    if feat["wave_max_24h_m"] > 1.2:
        return "swell"
    return "current"


def _earliest_real_date(session) -> date | None:
    """Return the earliest date covered by non-synthetic data, if any.

    Used to auto-place the synthetic window entirely *before* real weather /
    labels so our calm synthetic rows are never blocked by pre-existing rows
    (``on_conflict_do_nothing``) and the train/test split stays clean:
    synthetic history trains, real data tests.
    """
    candidates: list[date] = []
    wx_ts = (
        session.query(_db_mod.WeatherObs.ts)
        .filter(_db_mod.WeatherObs.source != SYNTHETIC_SOURCE)
        .order_by(_db_mod.WeatherObs.ts.asc())
        .first()
    )
    if wx_ts and wx_ts[0] is not None:
        candidates.append(wx_ts[0].date())
    lbl_d = (
        session.query(_db_mod.NoDiveLabel.date)
        .filter(_db_mod.NoDiveLabel.source != SYNTHETIC_SOURCE)
        .order_by(_db_mod.NoDiveLabel.date.asc())
        .first()
    )
    if lbl_d and lbl_d[0] is not None:
        candidates.append(lbl_d[0])
    return min(candidates) if candidates else None


def _clear_synthetic(session, sites, gen_first: date, last_day: date) -> dict[str, int]:
    """Delete previously generated synthetic rows for a clean rebuild.

    Weather / marine / labels are keyed by ``source == synthetic_scenario``.
    Tides carry no ``source`` column, so they are purged by *window* instead
    (the ``[gen_first, last_day]`` span we are about to rewrite). Because the
    synthetic window is placed clear of real data, this never touches real
    tide observations.
    """
    n_lbl = (
        session.query(_db_mod.NoDiveLabel)
        .filter(_db_mod.NoDiveLabel.source == SYNTHETIC_SOURCE)
        .delete(synchronize_session=False)
    )
    n_wx = (
        session.query(_db_mod.WeatherObs)
        .filter(_db_mod.WeatherObs.source == SYNTHETIC_SOURCE)
        .delete(synchronize_session=False)
    )
    n_mar = (
        session.query(_db_mod.MarineObs)
        .filter(_db_mod.MarineObs.source == SYNTHETIC_SOURCE)
        .delete(synchronize_session=False)
    )
    win_start = datetime(gen_first.year, gen_first.month, gen_first.day,
                         0, 0, 0, tzinfo=timezone.utc)
    win_end = datetime(last_day.year, last_day.month, last_day.day,
                       23, 59, 59, tzinfo=timezone.utc)
    n_tide = (
        session.query(_db_mod.TideObs)
        .filter(
            _db_mod.TideObs.site_key.in_([s["key"] for s in sites]),
            _db_mod.TideObs.ts >= win_start,
            _db_mod.TideObs.ts <= win_end,
        )
        .delete(synchronize_session=False)
    )
    session.commit()
    return {"labels": n_lbl, "weather": n_wx, "marine": n_mar, "tides": n_tide}


def _persist_hourly(session, site_key: str, ts, day: dict, h: int) -> None:
    """Upsert one hour of weather + marine + tide (skip on unique conflict)."""
    session.execute(
        sqlite_upsert(_db_mod.WeatherObs).values(
            site_key=site_key, ts=ts,
            precip_mm=day["precip_mm"][h],
            wind_max_kmh=day["wind_max_kmh"][h],
            wind_mean_kmh=day["wind_mean_kmh"][h],
            wave_max_m=day["wave_max_m"][h],
            sea_temp_c=day["sea_temp_c"][h],
            source=SYNTHETIC_SOURCE,
        ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
    )
    session.execute(
        sqlite_upsert(_db_mod.MarineObs).values(
            site_key=site_key, ts=ts,
            wave_height_m=day["wave_max_m"][h],
            wave_period_s=day["wave_period_s"][h],
            swell_height_m=day["swell_m"][h],
            swell_direction_deg=day["current_direction_deg"][h],
            water_temp_c=day["sea_temp_c"][h],
            current_speed_ms=day["current_speed_ms"][h],
            current_direction_deg=day["current_direction_deg"][h],
            source=SYNTHETIC_SOURCE,
        ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
    )
    session.execute(
        sqlite_upsert(_db_mod.TideObs).values(
            site_key=site_key, ts=ts, height_m=day["tide_m"][h],
        ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate multi-regime synthetic dive-condition datasets",
    )
    parser.add_argument("--days", type=int, default=180,
                        help="Number of labelled days per site (default: 180)")
    parser.add_argument("--seed", type=int, default=42,
                        help="RNG seed for reproducibility (default: 42)")
    parser.add_argument("--start-date", type=str, default=None,
                        help="First labelled day (YYYY-MM-DD). Default: auto-"
                             "placed just before existing real data.")
    parser.add_argument("--clear", action="store_true",
                        help="Delete prior synthetic_scenario rows first")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report the planned scenario mix without writing")
    args = parser.parse_args()

    init_db()

    # Place the synthetic window in a clean past region. By default it ends a
    # small margin before the earliest real observation/label so (a) our calm
    # synthetic rows are never blocked by pre-existing rows and (b) the time-
    # aware experiment split trains on synthetic history and tests on real data.
    if args.start_date:
        first_day = date.fromisoformat(args.start_date)
    else:
        _s = _db_mod.SessionLocal()
        try:
            earliest_real = _earliest_real_date(_s)
        finally:
            _s.close()
        anchor = earliest_real if earliest_real else date.today()
        last_day = anchor - timedelta(days=7)          # 1-week safety margin
        first_day = last_day - timedelta(days=args.days - 1)

    last_day = first_day + timedelta(days=args.days - 1)
    gen_first = first_day - timedelta(days=PAD_DAYS)

    sites = get_all_sites()
    print(f"Synthetic dataset generation - seed={args.seed}, "
          f"{args.days} days x {len(sites)} sites, "
          f"window {first_day.isoformat()} -> {last_day.isoformat()}")

    if args.clear and not args.dry_run:
        session = _db_mod.SessionLocal()
        try:
            removed = _clear_synthetic(session, sites, gen_first, last_day)
            print(f"  Cleared prior synthetic rows: {removed}")
        finally:
            session.close()

    SYNTHETIC_DIR.mkdir(parents=True, exist_ok=True)

    # Per-scenario CSV writers (the "multiple datasets") + a combined manifest.
    csv_rows: dict[str, list[dict]] = {name: [] for name in SCENARIOS}
    class_counts = {"dive": 0, "poor_viz": 0, "no_dive": 0}
    scenario_counts: dict[str, int] = {name: 0 for name in SCENARIOS}
    total_weather = 0
    total_labels = 0

    for site in sites:
        site_key = site["key"]
        rng = np.random.default_rng(args.seed + hash(site_key) % 10_000)

        # Assign a regime to every day, including PAD_DAYS of lead-in.
        n_gen_days = args.days + PAD_DAYS
        day_scenarios = _assign_daily_scenarios(rng, n_gen_days)
        gen_first = first_day - timedelta(days=PAD_DAYS)

        print(f"\n-- {site['name']} ({site_key}) --")
        if args.dry_run:
            from collections import Counter
            mix = Counter(day_scenarios[PAD_DAYS:])
            for name, cnt in mix.most_common():
                print(f"    {name:<16} {cnt} days")
            continue

        # Step 1: write the full continuous hourly series (lead-in + labelled).
        session = _db_mod.SessionLocal()
        try:
            for di in range(n_gen_days):
                scenario = day_scenarios[di]
                day = _hourly_series_for_day(rng, scenario, di, site_key)
                cur_day = gen_first + timedelta(days=di)
                for h in range(24):
                    ts = datetime(cur_day.year, cur_day.month, cur_day.day,
                                  h, 0, 0, tzinfo=timezone.utc)
                    _persist_hourly(session, site_key, ts, day, h)
                    total_weather += 1
                if di % 30 == 0:
                    session.commit()
            session.commit()
        except Exception as exc:
            session.rollback()
            print(f"  ERROR writing observations: {exc}")
            session.close()
            return 1
        finally:
            session.close()
        print(f"  Wrote {n_gen_days * 24} hourly obs rows")

        # Step 2: derive one rule-based label per labelled day from the now
        # fully-populated windows.
        session = _db_mod.SessionLocal()
        labels_made = 0
        try:
            for di in range(PAD_DAYS, n_gen_days):
                cur_day = gen_first + timedelta(days=di)
                scenario = day_scenarios[di]
                target_ts = datetime(cur_day.year, cur_day.month, cur_day.day,
                                      12, 0, 0, tzinfo=timezone.utc)
                feat_df = build_features(site_key, target_ts)
                feat = dict(zip(FEATURE_COLUMNS, feat_df.values[0]))
                viz, curr = score_hour(feat)
                rl = risk_label(viz, curr)
                if rl == "HIGH RISK":
                    label, viz_est = "no_dive", 3.0
                elif rl == "MODERATE":
                    label, viz_est = "poor_viz", 8.0
                else:
                    label, viz_est = "dive", 16.0
                reason = _no_go_reason(viz, curr, feat)
                actual_current = ("High" if curr == "High"
                                  else "Moderate" if curr == "Moderate" else "Low")

                session.execute(
                    sqlite_upsert(_db_mod.NoDiveLabel).values(
                        site_key=site_key, date=cur_day, label=label,
                        source=SYNTHETIC_SOURCE, actual_viz_m=viz_est,
                        actual_current=actual_current, no_go_reason=reason,
                        confidence=SCENARIOS[scenario]["confidence"],
                        comments=f"scenario={scenario}; viz={viz}; current={curr}",
                    ).on_conflict_do_nothing(
                        index_elements=["site_key", "date", "source"]
                    )
                )
                labels_made += 1
                class_counts[label] += 1
                scenario_counts[scenario] += 1

                csv_rows[scenario].append({
                    "date": cur_day.isoformat(),
                    "site_key": site_key,
                    "rain_mm": round(feat["precip_24h_mm"], 2),
                    "wind_max_kmh": round(feat["wind_max_24h_kmh"], 2),
                    "wave_m": round(feat["wave_max_24h_m"], 2),
                    "tide_range_m": round(feat["tide_range_24h_m"], 2),
                    "actual_viz_m": viz_est,
                    "current": actual_current,
                    "actual_current": actual_current,
                    "label": label,
                    "no_go_reason": reason or "",
                    "confidence": SCENARIOS[scenario]["confidence"],
                    "comments": f"scenario={scenario}",
                })
                if labels_made % 60 == 0:
                    session.commit()
            session.commit()
            total_labels += labels_made
            print(f"  Created {labels_made} synthetic labels")
        except Exception as exc:
            session.rollback()
            print(f"  ERROR generating labels: {exc}")
            session.close()
            return 1
        finally:
            session.close()

    if args.dry_run:
        print("\nDry run complete - no rows written.")
        return 0

    # ── Export per-scenario CSV datasets + manifest ─────────────────────────
    csv_header = [
        "date", "site_key", "rain_mm", "wind_max_kmh", "wave_m", "tide_range_m",
        "actual_viz_m", "current", "actual_current", "label", "no_go_reason",
        "confidence", "comments",
    ]
    written_files = []
    for name, rows in csv_rows.items():
        if not rows:
            continue
        path = SYNTHETIC_DIR / f"{name}.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=csv_header)
            writer.writeheader()
            writer.writerows(rows)
        written_files.append(path.name)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "days_per_site": args.days,
        "sites": [s["key"] for s in sites],
        "first_labelled_day": first_day.isoformat(),
        "source_tag": SYNTHETIC_SOURCE,
        "hourly_obs_written": total_weather,
        "labels_written": total_labels,
        "class_balance": class_counts,
        "scenario_label_counts": scenario_counts,
        "scenario_files": written_files,
        "feature_columns": list(FEATURE_COLUMNS),
    }
    with open(SYNTHETIC_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # ── Summary ─────────────────────────────────────────────────────────────
    session = _db_mod.SessionLocal()
    try:
        total_db_labels = session.query(_db_mod.NoDiveLabel).count()
        synth_db_labels = (
            session.query(_db_mod.NoDiveLabel)
            .filter(_db_mod.NoDiveLabel.source == SYNTHETIC_SOURCE)
            .count()
        )
    finally:
        session.close()

    pos = class_counts["poor_viz"] + class_counts["no_dive"]
    total = sum(class_counts.values()) or 1
    print(f"\n{'=' * 60}")
    print("Synthetic dataset generation complete!")
    print(f"  Hourly obs written : {total_weather}")
    print(f"  Labels written     : {total_labels}")
    print(f"  Class balance      : {class_counts} "
          f"(positive/no-go ratio = {pos / total:.2f})")
    print(f"  Per-scenario CSVs  : {SYNTHETIC_DIR}")
    print(f"  DB labels total    : {total_db_labels} "
          f"({synth_db_labels} synthetic_scenario)")
    print(f"{'=' * 60}")
    print("Next: python -m scripts.train_model   # retrain LSTM + XGBoost")
    return 0


if __name__ == "__main__":
    sys.exit(main())
