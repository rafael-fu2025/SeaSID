from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.lib import ml_pipeline
from app.lib import features
from app.lib.features import FEATURE_COLUMNS
from app.lib.model_lstm import LSTMTrainConfig, train_lstm


def test_flat_examples_use_issue_time_not_target_time(monkeypatch):
    observed_cutoffs = []

    def fake_features(site_key, cutoff):
        observed_cutoffs.append(cutoff)
        return pd.DataFrame([[1.0] * len(FEATURE_COLUMNS)], columns=FEATURE_COLUMNS)

    monkeypatch.setattr(ml_pipeline, "build_features", fake_features)
    labels = pd.DataFrame([{
        "id": 7,
        "site_key": "apo_reef",
        "date": pd.Timestamp("2026-01-10", tz="UTC"),
        "label": "no_dive",
        "source": "operator_log",
        "target": 1,
        "trusted_label": True,
    }])
    examples, report = ml_pipeline.build_flat_examples(labels, horizon_hours=24)

    assert report["final_rows"] == 1
    assert observed_cutoffs == [datetime(2026, 1, 9, 12, tzinfo=timezone.utc)]
    assert examples.loc[0, "target_ts"].startswith("2026-01-10T12:00:00")


def test_flat_examples_handle_empty_labels():
    frame, report = ml_pipeline.build_flat_examples(pd.DataFrame(), 24)
    assert frame.empty
    assert set(FEATURE_COLUMNS).issubset(frame.columns)
    assert report == {"input_labels": 0, "rejected_rows": 0, "final_rows": 0}


def test_dataset_version_survives_csv_round_trip(tmp_path):
    frame = pd.DataFrame({
        "target_ts": ["2025-01-02T12:00:00+00:00"],
        "site_key": ["apo_reef"],
        "value": [0.123456789123],
        "trusted_label": [True],
    })
    path = tmp_path / "dataset.csv"
    frame.to_csv(path, index=False)
    assert ml_pipeline.dataset_version(frame) == ml_pipeline.dataset_version(pd.read_csv(path))


def test_chronological_split_is_ordered_and_purged():
    target = pd.date_range("2025-01-01", periods=40, freq="D", tz="UTC")
    frame = pd.DataFrame({
        "target_ts": target,
        "issue_ts": target - pd.Timedelta(hours=24),
        "target": np.tile([0, 1], 20),
    })
    split = ml_pipeline.chronological_split(frame, purge_hours=24)

    assert split.train["target_ts"].max() < split.validation["issue_ts"].min() - pd.Timedelta(hours=24)
    assert split.validation["target_ts"].max() < split.test["issue_ts"].min() - pd.Timedelta(hours=24)


def test_promotion_gate_rejects_small_or_single_class_dataset():
    config = {
        "dataset": {
            "minimum_total_labels_for_promotion": 500,
            "minimum_labels_per_class_for_promotion": 100,
        }
    }
    result = ml_pipeline.promotion_eligibility(pd.DataFrame({"target": [1] * 20}), config)
    assert result["eligible"] is False
    assert len(result["reasons"]) == 3


def test_lstm_scaler_is_fit_on_internal_training_rows_only():
    # With chronological dates, the last 15% are validation. Extreme values in
    # that validation tail must not influence the fitted scaler mean.
    X = np.zeros((20, 2, len(FEATURE_COLUMNS)), dtype=np.float32)
    X[17:] = 1000.0
    y = np.tile([0, 1], 10).astype(np.float32)
    dates = list(pd.date_range("2025-01-01", periods=20, freq="D").date)
    result = train_lstm(
        X,
        y,
        LSTMTrainConfig(
            seq_len=2, hidden_size=4, num_layers=1, dropout=0.0,
            batch_size=8, max_epochs=1, patience=1, random_seed=42,
        ),
        label_dates=dates,
    )
    assert np.allclose(result.scaler.mean_, 0.0)
    assert result.metrics["evaluation_split"] == "validation"


def test_batched_flat_features_exclude_rows_after_each_cutoff(monkeypatch):
    weather = pd.DataFrame({
        "ts": pd.to_datetime(["2025-01-01T12:00:00Z", "2025-01-03T12:00:00Z"]),
        "precip_mm": [1.0, 100.0],
        "wind_max_kmh": [10.0, 200.0],
        "wind_mean_kmh": [5.0, 100.0],
        "wave_max_m": [0.5, 9.0],
        "sea_temp_c": [28.0, 40.0],
    })
    monkeypatch.setattr(features, "_fetch_weather_window", lambda *args, **kwargs: weather)
    monkeypatch.setattr(
        features, "_fetch_tide_window",
        lambda *args, **kwargs: pd.DataFrame(columns=["ts", "height_m"]),
    )
    monkeypatch.setattr(
        features, "_fetch_marine_window",
        lambda *args, **kwargs: pd.DataFrame(columns=["ts", "wave_height_m", "wave_period_s"]),
    )
    monkeypatch.setattr(features, "_fetch_air_window", lambda *args, **kwargs: pd.DataFrame())

    result = features.build_features_for_window(
        "apo_reef", [datetime(2025, 1, 2, 12, tzinfo=timezone.utc)],
    )
    assert result.loc[0, "precip_48h_mm"] == 1.0
    assert result.loc[0, "wind_max_24h_kmh"] == 10.0
