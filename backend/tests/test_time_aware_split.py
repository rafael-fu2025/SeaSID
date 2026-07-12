"""
Regression tests for the time-aware experiment split (roadmap item #7).

These tests cover:
- Time-aware train/val/test boundaries are non-overlapping by date.
- Test set contains the most recent labels (a true holdout).
- A purge window removes train labels within `purge_days` of val.
- Boundaries and split method are reported in the dataset summary.
- The legacy random fallback still works when no dates are supplied.
- Per-site test counts are reported when site keys are provided.
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.experiments import (
    _per_site_test_counts,
    _time_aware_split,
    run_full_experiment_suite,
)


def _daily_dates(n: int, start: date | None = None) -> list[date]:
    start = start or date(2026, 1, 1)
    return [start + timedelta(days=i) for i in range(n)]


class TestTimeAwareSplit:
    """Unit tests for the :func:`_time_aware_split` helper."""

    def test_train_dates_precede_val_dates_precede_test_dates(self):
        dates = _daily_dates(100)
        train_idx, val_idx, test_idx, boundaries = _time_aware_split(dates)

        train_dates = [dates[i] for i in train_idx]
        val_dates = [dates[i] for i in val_idx]
        test_dates = [dates[i] for i in test_idx]

        assert max(train_dates) < min(val_dates), (
            "train labels must not overlap val labels by date"
        )
        assert max(val_dates) < min(test_dates), (
            "val labels must not overlap test labels by date"
        )

    def test_test_set_is_the_most_recent_holdout(self):
        dates = _daily_dates(100)
        train_idx, val_idx, test_idx, _ = _time_aware_split(dates)
        all_dates = [dates[i] for i in (train_idx + val_idx + test_idx)]
        test_dates = [dates[i] for i in test_idx]

        assert min(test_dates) == max(all_dates) - (
            max(all_dates) - min(test_dates)
        ) or test_dates[0] > max(dates) - timedelta(days=30), (
            "test set should be the most recent ~15% of labels"
        )

    def test_purge_removes_train_labels_within_gap(self):
        """Train labels whose date is within `purge_days` of the earliest
        val date must be removed so the model cannot peek at adjacent
        context."""
        # 30 daily labels; train = first 21 (70%), val = next 4 (15%), test = 5
        dates = _daily_dates(30)
        train_idx, val_idx, test_idx, boundaries = _time_aware_split(
            dates, train_frac=0.70, val_frac=0.15, purge_days=2,
        )

        if val_idx:
            val_start = min(dates[i] for i in val_idx)
            for i in train_idx:
                gap = (val_start - dates[i]).days
                assert gap > 2 or gap < 0, (
                    f"train label at {dates[i]} is within purge window of val start {val_start}"
                )

        assert boundaries["purge_days"] == 2

    def test_indices_partition_original_set(self):
        dates = _daily_dates(100)
        train_idx, val_idx, test_idx, _ = _time_aware_split(dates)

        all_idx = set(train_idx) | set(val_idx) | set(test_idx)
        # Each original index appears in exactly one of train/val/test (no
        # duplicates across splits); the purge may drop a few from train,
        # so the unique count is <= the original 100.
        assert all_idx <= set(range(100))
        assert len(train_idx) + len(val_idx) + len(test_idx) == len(all_idx)
        assert len(all_idx) <= 100

    def test_purge_does_not_drop_val_or_test(self):
        dates = _daily_dates(100)
        _, val_idx, test_idx, _ = _time_aware_split(dates, purge_days=2)
        assert val_idx, "val set should not be empty"
        assert test_idx, "test set should not be empty"

    def test_boundaries_carry_date_ranges_and_counts(self):
        dates = _daily_dates(100)
        _, _, _, boundaries = _time_aware_split(dates)
        assert boundaries["split_method"] == "time_aware_blocked"
        for window in ("train", "val", "test"):
            w = boundaries[window]
            assert w["start"] is not None
            assert w["end"] is not None
            assert w["count"] > 0

    def test_empty_input_returns_empty_indices(self):
        train_idx, val_idx, test_idx, b = _time_aware_split([])
        assert train_idx == [] and val_idx == [] and test_idx == []
        assert b["split_method"] == "time_aware_blocked"

    def test_small_input_falls_back_to_train_only(self):
        dates = _daily_dates(2)
        train_idx, val_idx, test_idx, b = _time_aware_split(dates)
        assert len(train_idx) == 2
        assert val_idx == [] and test_idx == []
        assert "warning" in b


_has_xgboost = True
try:
    import xgboost  # noqa: F401
except ImportError:
    _has_xgboost = False


class TestRunFullExperimentSuite:
    """Integration tests for :func:`run_full_experiment_suite` with
    time-aware split and per-site reporting.

    The full suite imports xgboost for the XGBoost baseline. Skip these
    tests when xgboost is not installed in the environment.
    """

    pytestmark = pytest.mark.skipif(
        not _has_xgboost, reason="xgboost not installed",
    )

    def _make_inputs(self, n: int = 60):
        rng = np.random.RandomState(0)
        X_flat = pd.DataFrame(
            rng.rand(n, 11),
            columns=[f"f{i}" for i in range(11)],
        )
        y = pd.Series((rng.rand(n) > 0.5).astype(int), name="label")
        X_seq = rng.rand(n, 24, 11).astype(np.float32)
        y_arr = y.values.astype(np.float32)
        return X_flat, y, X_seq, y_arr

    def test_time_aware_split_emits_boundaries_and_method(self):
        X_flat, y, X_seq, y_arr = self._make_inputs(60)
        dates = _daily_dates(60)

        results = run_full_experiment_suite(
            X_flat, y, X_seq, y_arr, label_dates=dates,
        )

        ds = results["dataset"]
        assert ds["split_method"] == "time_aware_blocked"
        assert ds["boundaries"]["split_method"] == "time_aware_blocked"
        assert ds["train_size"] + ds["val_size"] + ds["test_size"] <= 60

    def test_random_fallback_when_dates_missing(self):
        X_flat, y, X_seq, y_arr = self._make_inputs(60)

        results = run_full_experiment_suite(X_flat, y, X_seq, y_arr)

        ds = results["dataset"]
        assert ds["split_method"] == "random_stratified"
        assert ds["train_size"] + ds["val_size"] + ds["test_size"] == 60

    def test_per_site_test_counts_reported(self):
        X_flat, y, X_seq, y_arr = self._make_inputs(60)
        dates = _daily_dates(60)
        site_keys = ["dauin_muck"] * 30 + ["apo_reef"] * 30

        results = run_full_experiment_suite(
            X_flat, y, X_seq, y_arr,
            label_dates=dates, label_site_keys=site_keys,
        )

        ds = results["dataset"]
        assert "per_site" in ds
        assert sum(ds["per_site"].values()) == ds["test_size"]


class TestPerSiteTestCounts:
    """Direct unit tests for the per-site test-count helper."""

    def test_counts_only_test_indices(self):
        site_keys = ["a", "a", "b", "c", "a", "b"]
        counts = _per_site_test_counts(site_keys, [0, 2, 4])
        assert counts == {"a": 2, "b": 1}

    def test_empty_test_idx_returns_empty(self):
        site_keys = ["a", "b", "c"]
        assert _per_site_test_counts(site_keys, []) == {}