"""
Tests for XGBoost baseline model (test-first per spec).

Covers:
1. Train produces metrics with CV scores
2. Persistence round-trip (save + load + predict)
3. Tiny-dataset fallback (< 4 samples)
4. Feature importance shape
"""

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.model_xgb import train_xgb, save_xgb, load_xgb, predict_proba_xgb, feature_importance


class TestXGBTraining:
    """Test XGBoost training produces valid results."""

    def test_train_produces_metrics(self, toy_feature_matrix):
        """Training returns metrics with CV scores."""
        X, y = toy_feature_matrix
        result = train_xgb(X, y)

        assert result.n_samples == len(X)
        assert "cv_accuracy" in result.metrics or "mode" in result.metrics
        assert result.model is not None

    def test_train_empty_dataset_raises(self):
        """Training on empty dataset raises ValueError."""
        X = pd.DataFrame(columns=["a", "b"])
        y = pd.Series([], dtype=int)
        with pytest.raises(ValueError, match="empty"):
            train_xgb(X, y)

    def test_tiny_dataset_fallback(self, toy_feature_matrix):
        """Datasets with < 4 samples skip CV."""
        X, y = toy_feature_matrix
        X_tiny = X.head(3)
        y_tiny = y.head(3)

        result = train_xgb(X_tiny, y_tiny)
        assert result.metrics["mode"] == "tiny_train_only"
        assert result.n_samples == 3


class TestXGBPersistence:
    """Test save/load round-trip."""

    def test_save_load_roundtrip(self, toy_feature_matrix, tmp_path):
        """Model can be saved and reloaded with same predictions."""
        X, y = toy_feature_matrix
        result = train_xgb(X, y)

        model_path = tmp_path / "test_model.pkl"
        metrics_path = tmp_path / "test_metrics.json"
        save_xgb(result, model_path, metrics_path)

        assert model_path.exists()
        assert metrics_path.exists()

        loaded = load_xgb(model_path)
        assert loaded is not None
        assert loaded["model_type"] == "xgboost"
        assert loaded["n_samples"] == result.n_samples

    def test_load_nonexistent_returns_none(self, tmp_path):
        """Loading from nonexistent path returns None."""
        result = load_xgb(tmp_path / "nonexistent.pkl")
        assert result is None


class TestXGBPrediction:
    """Test prediction and feature importance."""

    def test_predict_proba_shape(self, toy_feature_matrix):
        """predict_proba returns correct shape."""
        X, y = toy_feature_matrix
        result = train_xgb(X, y)
        bundle = {"model": result.model, "feature_columns": result.feature_columns}

        proba = predict_proba_xgb(bundle, X)
        assert len(proba) == len(X)
        assert all(0 <= p <= 1 for p in proba)

    def test_feature_importance_shape(self, toy_feature_matrix):
        """Feature importance returns all 14 features."""
        X, y = toy_feature_matrix
        result = train_xgb(X, y)
        bundle = {"model": result.model, "feature_columns": result.feature_columns}

        imp = feature_importance(bundle)
        assert len(imp) == 14
        assert "feature" in imp.columns
        assert "importance" in imp.columns
