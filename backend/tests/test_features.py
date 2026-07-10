"""
Tests for feature engineering (test-first per spec).

Covers:
1. Schema correctness — output has exactly 14 columns in the right order
   (11 legacy v2 columns + aqi_recent + pm25_recent + wave_period_s_mean)
2. 24h/48h/3h rolling windows — precipitation sums are computed correctly
3. Synthetic fallback — features still produced when DB has no data
4. is_muck_site flag — correctly set based on site type
5. Air-quality + marine defaults when no data is present
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.features import FEATURE_COLUMNS, build_features, build_sequence


class TestFeatureSchema:
    """Test 1: Schema correctness."""

    def test_feature_columns_count(self):
        """FEATURE_COLUMNS has exactly 14 entries (v2.1 contract)."""
        assert len(FEATURE_COLUMNS) == 14

    def test_legacy_eleven_columns_unchanged(self):
        """First 11 column names match the v2 contract exactly."""
        legacy = [
            "precip_24h_mm", "precip_48h_mm", "precip_recent_3h",
            "wind_max_24h_kmh", "wind_mean_24h_kmh",
            "wave_max_24h_m", "sea_temp_mean_24h",
            "tide_max_24h_m", "tide_min_24h_m", "tide_range_24h_m",
            "is_muck_site",
        ]
        assert FEATURE_COLUMNS[:11] == legacy

    def test_extension_columns_present(self):
        """Columns 12-14 are the v2.1 extensions."""
        assert FEATURE_COLUMNS[11] == "aqi_recent"
        assert FEATURE_COLUMNS[12] == "pm25_recent"
        assert FEATURE_COLUMNS[13] == "wave_period_s_mean"

    def test_build_features_returns_correct_shape(self, seeded_weather, seeded_tides):
        """build_features returns a 1-row DataFrame with 14 columns."""
        target_ts, _ = seeded_weather
        df = build_features("dauin_muck", target_ts)

        assert df.shape == (1, 14)
        assert list(df.columns) == FEATURE_COLUMNS

    def test_build_features_all_numeric(self, seeded_weather, seeded_tides):
        """All features are numeric (float)."""
        target_ts, _ = seeded_weather
        df = build_features("dauin_muck", target_ts)

        for col in FEATURE_COLUMNS:
            assert pd.api.types.is_numeric_dtype(df[col]), f"{col} is not numeric"


class TestRollingWindows:
    """Test 2: Rolling window computations."""

    def test_precip_24h_less_than_48h(self, seeded_weather, seeded_tides):
        """24h precipitation sum should be ≤ 48h sum."""
        target_ts, _ = seeded_weather
        df = build_features("dauin_muck", target_ts)

        assert df["precip_24h_mm"].iloc[0] <= df["precip_48h_mm"].iloc[0]

    def test_precip_3h_less_than_24h(self, seeded_weather, seeded_tides):
        """3h precipitation sum should be ≤ 24h sum."""
        target_ts, _ = seeded_weather
        df = build_features("dauin_muck", target_ts)

        assert df["precip_recent_3h"].iloc[0] <= df["precip_24h_mm"].iloc[0]

    def test_tide_range_equals_max_minus_min(self, seeded_weather, seeded_tides):
        """Tide range should equal max - min."""
        target_ts, _ = seeded_weather
        df = build_features("dauin_muck", target_ts)

        expected_range = df["tide_max_24h_m"].iloc[0] - df["tide_min_24h_m"].iloc[0]
        assert abs(df["tide_range_24h_m"].iloc[0] - expected_range) < 1e-6


class TestSyntheticFallback:
    """Test 3: Features produced even with no data in DB."""

    def test_empty_db_returns_valid_features(self):
        """build_features returns valid (zero-filled) features when DB is empty."""
        ts = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        df = build_features("dauin_muck", ts)

        assert df.shape == (1, 14)
        # With no data, sums/maxes should be 0
        assert df["precip_24h_mm"].iloc[0] == 0.0
        assert df["wind_max_24h_kmh"].iloc[0] == 0.0
        # Air-quality + marine defaults from v2.1
        assert df["aqi_recent"].iloc[0] == pytest.approx(30.0)
        assert df["pm25_recent"].iloc[0] == pytest.approx(8.0)
        assert df["wave_period_s_mean"].iloc[0] == pytest.approx(6.0)

    def test_empty_db_sea_temp_has_default(self):
        """Sea temp uses climatology default (28°C) when no data available."""
        ts = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        df = build_features("dauin_muck", ts)

        assert df["sea_temp_mean_24h"].iloc[0] == pytest.approx(28.0, abs=0.1)


class TestMuckSiteFlag:
    """Test 4: is_muck_site flag."""

    def test_dauin_is_muck(self, seeded_weather, seeded_tides):
        """Dauin should be flagged as muck site."""
        target_ts, _ = seeded_weather
        df = build_features("dauin_muck", target_ts)
        assert df["is_muck_site"].iloc[0] == 1.0

    def test_apo_is_not_muck(self):
        """Apo Island should NOT be flagged as muck site."""
        ts = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        df = build_features("apo_reef", ts)
        assert df["is_muck_site"].iloc[0] == 0.0


class TestBuildSequence:
    """Test build_sequence for LSTM input."""

    def test_sequence_shape(self, seeded_weather, seeded_tides):
        """build_sequence returns (window_hours, 14) array."""
        target_ts, _ = seeded_weather
        seq = build_sequence("dauin_muck", target_ts, window_hours=12)

        assert seq.shape == (12, 14)
        assert seq.dtype == np.float32
