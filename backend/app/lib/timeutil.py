"""Timezone normalization helpers — single source of truth (audit F-B1-23).

SQLite drops ``tzinfo`` on read even from ``DateTime(timezone=True)``
columns, and pandas 3.x enforces strict dtype equality for comparisons.
The naive-UTC dance was previously re-implemented in features.py,
ingest.py, freshness.py and db.py; every module should use these.
"""
from __future__ import annotations

import pandas as pd


def to_naive_utc(ts) -> "pd.Timestamp":
    """Convert any datetime-like to a tz-naive pandas Timestamp in UTC."""
    out = pd.Timestamp(ts)
    if out.tzinfo is not None:
        out = out.tz_convert("UTC").tz_localize(None)
    return out


def normalize_ts_column(series: pd.Series) -> pd.Series:
    """Return a tz-naive UTC datetime64 Series (no-op if already naive)."""
    if series.empty:
        return series
    if pd.api.types.is_datetime64_any_dtype(series):
        if getattr(series.dt, "tz", None) is not None:
            return series.dt.tz_convert("UTC").dt.tz_localize(None)
        return series
    converted = pd.to_datetime(series, utc=True, errors="coerce")
    return converted.dt.tz_convert("UTC").dt.tz_localize(None)


def strip_tz_utc(ts):
    """Naive-UTC python datetime (used for SQLite writes), or None."""
    if ts is None:
        return None
    return ts.replace(tzinfo=None) if ts.tzinfo else ts
