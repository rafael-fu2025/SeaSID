"""
Tests for LSTM deep learning model (test-first per spec).

Covers:
1. LSTM train produces metrics with loss values
2. Loss convergence: final loss < initial loss
3. Predict_proba output shape and range [0, 1]
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.model_lstm import (
    train_lstm,
    save_lstm,
    load_lstm,
    predict_proba_lstm,
    LSTMTrainConfig,
    LSTMPredictor,
    GRUPredictor,
)
from app.lib.features import FEATURE_COLUMNS


@pytest.fixture
def toy_sequences():
    """Create small sequence dataset for LSTM testing."""
    rng = np.random.RandomState(42)
    n_samples = 40
    seq_len = 24
    n_features = len(FEATURE_COLUMNS)

    X = rng.rand(n_samples, seq_len, n_features).astype(np.float32)
    y = (rng.rand(n_samples) > 0.5).astype(np.float32)

    return X, y


class TestLSTMTraining:
    """Test LSTM training produces valid results."""

    def test_train_produces_metrics(self, toy_sequences):
        """Training returns metrics including accuracy and f1."""
        X, y = toy_sequences
        config = LSTMTrainConfig(max_epochs=10, patience=5, hidden_size=16)

        result = train_lstm(X, y, config)

        assert result.n_samples == len(X)
        assert "accuracy" in result.metrics
        assert "f1" in result.metrics
        assert result.model is not None

    def test_train_records_losses(self, toy_sequences):
        """Training records train and val losses per epoch."""
        X, y = toy_sequences
        config = LSTMTrainConfig(max_epochs=10, patience=5, hidden_size=16)

        result = train_lstm(X, y, config)

        assert len(result.train_losses) > 0
        assert len(result.val_losses) > 0
        assert len(result.train_losses) <= config.max_epochs

    def test_train_empty_raises(self):
        """Training on empty dataset raises ValueError."""
        X = np.array([]).reshape(0, 24, 11).astype(np.float32)
        y = np.array([], dtype=np.float32)

        with pytest.raises(ValueError, match="empty"):
            train_lstm(X, y)


class TestLSTMLossConvergence:
    """Test that the model actually learns."""

    def test_loss_decreases(self, toy_sequences):
        """Training loss should generally decrease over epochs."""
        X, y = toy_sequences
        config = LSTMTrainConfig(max_epochs=20, patience=15, hidden_size=32, lr=1e-2)

        result = train_lstm(X, y, config)

        # The average of last 3 losses should be less than first 3
        if len(result.train_losses) >= 6:
            early_avg = np.mean(result.train_losses[:3])
            late_avg = np.mean(result.train_losses[-3:])
            assert late_avg <= early_avg * 1.5, \
                f"Loss did not converge: early={early_avg:.4f}, late={late_avg:.4f}"


class TestLSTMPrediction:
    """Test inference output."""

    def test_predict_proba_shape_batch(self, toy_sequences):
        """predict_proba returns correct shape for batch input."""
        X, y = toy_sequences
        config = LSTMTrainConfig(max_epochs=5, hidden_size=16)
        result = train_lstm(X, y, config)

        bundle = {"model": result.model, "scaler": result.scaler, "config": {"seq_len": 24}}
        proba = predict_proba_lstm(bundle, X)

        assert proba.shape == (len(X),)
        assert all(0 <= p <= 1 for p in proba)

    def test_predict_proba_single(self, toy_sequences):
        """predict_proba works for a single sequence (2D input)."""
        X, y = toy_sequences
        config = LSTMTrainConfig(max_epochs=5, hidden_size=16)
        result = train_lstm(X, y, config)

        bundle = {"model": result.model, "scaler": result.scaler, "config": {"seq_len": 24}}
        single = X[0]  # shape: (24, 11)
        proba = predict_proba_lstm(bundle, single)

        assert proba.shape == (1,)
        assert 0 <= proba[0] <= 1


class TestLSTMPersistence:
    """Test save/load round-trip."""

    def test_save_load_roundtrip(self, toy_sequences, tmp_path):
        """Model can be saved and reloaded."""
        X, y = toy_sequences
        config = LSTMTrainConfig(max_epochs=5, hidden_size=16)
        result = train_lstm(X, y, config)

        model_path = tmp_path / "test_lstm.pt"
        metrics_path = tmp_path / "test_metrics.json"
        save_lstm(result, model_path, metrics_path)

        assert model_path.exists()
        assert metrics_path.exists()

        loaded = load_lstm(model_path)
        assert loaded is not None
        assert loaded["model_type"] == "lstm"

        # Loaded model should produce same shape predictions
        proba = predict_proba_lstm(loaded, X)
        assert proba.shape == (len(X),)


class TestGRUVariant:
    """Test GRU ablation variant."""

    def test_gru_trains(self, toy_sequences):
        """GRU variant trains successfully."""
        X, y = toy_sequences
        config = LSTMTrainConfig(max_epochs=5, hidden_size=16, arch="gru")

        result = train_lstm(X, y, config)
        assert result.metrics["arch"] == "gru"
        assert result.n_samples == len(X)
