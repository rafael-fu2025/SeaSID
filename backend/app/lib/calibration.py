"""
Phase 7 — Probability calibration.

The point of calibration: when the model says "73% no-go", that should
actually mean historically ~73% of days that scored 0.73 were no-go days.
Tree models (XGBoost) and LSTM raw sigmoids are usually *over-confident*
at the extremes — they output 0.95 for things that are only 0.70 likely.

The fix is a post-hoc calibrator trained on the time-aware holdout.
Two flavours, both from scikit-learn:

* **Platt** (``LogisticRegression`` on the logit) — 2 parameters, smooth,
  robust on small holdouts (< 100 samples). Best when miscalibration is
  monotone.
* **Isotonic** (``IsotonicRegression``) — non-parametric, monotone step
  function. More flexible but needs >= 200 samples to avoid overfitting.
  Falls back to Platt below that threshold.

The calibrator that minimises the holdout Brier score wins, and the
choice is persisted to ``calibrator.pkl`` so production can apply it
without re-fitting.

Usage::

    # At training time (after LSTM/XGB fit, on time-aware holdout):
    cal = Calibrator(method="auto")
    cal.fit(p_raw_holdout, y_holdout)
    cal.save(DATA_DIR / "calibrator.pkl")

    # At inference time:
    cal = Calibrator.load(DATA_DIR / "calibrator.pkl") or Calibrator.identity()
    p_calibrated = cal.predict(p_raw)
"""
from __future__ import annotations

import logging
import pickle
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss

logger = logging.getLogger(__name__)


# ── Calibration data class ─────────────────────────────────────────────────

@dataclass
class CalibrationMetrics:
    """Metrics for one candidate calibrator on the holdout."""
    method: str  # "platt" | "isotonic" | "identity"
    n_holdout: int
    brier_raw: float
    brier_calibrated: float
    improvement: float  # brier_raw - brier_calibrated (positive = better)
    ece_raw: float
    ece_calibrated: float


@dataclass
class Calibrator:
    """Wraps either a Platt (logistic) or isotonic calibrator.

    The ``method`` field is recorded for diagnostics — production code
    only uses ``predict(probs)``.
    """
    method: Literal["platt", "isotonic", "identity"]
    # Either a fitted sklearn LogisticRegression (Platt) or
    # IsotonicRegression (isotonic). ``identity`` means no calibration.
    _model: object | None = None
    # Metrics recorded at fit time, for the model_version string
    metrics: CalibrationMetrics | None = None
    # How many training rows were used to fit — for diagnostics
    n_fit: int = 0

    # ── Factory methods ────────────────────────────────────────────────

    @classmethod
    def identity(cls) -> "Calibrator":
        """No calibration — passthrough. Use when holdout is too small."""
        return cls(method="identity", _model=None, n_fit=0)

    @classmethod
    def platt(cls, p_raw: np.ndarray, y: np.ndarray) -> "Calibrator":
        """Fit Platt scaling (1-D logistic regression on the logit)."""
        # Clamp to avoid log(0)/log(1) = -inf / +inf
        eps = 1e-6
        p_clip = np.clip(np.asarray(p_raw, dtype=float), eps, 1 - eps)
        logits = np.log(p_clip / (1 - p_clip)).reshape(-1, 1)
        lr = LogisticRegression(C=1.0, solver="lbfgs", max_iter=200)
        lr.fit(logits, np.asarray(y, dtype=int))
        return cls(method="platt", _model=lr, n_fit=len(p_raw))

    @classmethod
    def isotonic(cls, p_raw: np.ndarray, y: np.ndarray) -> "Calibrator":
        """Fit isotonic regression (monotone step function)."""
        ir = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        ir.fit(np.asarray(p_raw, dtype=float), np.asarray(y, dtype=int))
        return cls(method="isotonic", _model=ir, n_fit=len(p_raw))

    @classmethod
    def auto(
        cls,
        p_raw: np.ndarray,
        y: np.ndarray,
        min_isotonic_samples: int = 100,
    ) -> "Calibrator":
        """Fit Platt and (optionally) isotonic; return whichever has lower Brier.

        * < 30 samples → identity (insufficient data)
        * 30..min_isotonic_samples samples → Platt only
        * >= min_isotonic_samples samples → Platt vs isotonic, pick winner
        * If source probability has < 5 unique values (rule-based
          scorers often only output 0.10/0.45/0.85), fall back to a
          per-unique-value empirical-bin isotonic.
        """
        n = len(p_raw)
        if n < 30:
            logger.info(
                "Calibrator.auto: only %d holdout samples — using identity "
                "(need >= 30 to fit anything meaningful).", n,
            )
            cal = cls.identity()
            cal.calibrate_metrics(p_raw, np.asarray(y, dtype=int))
            return cal

        y_arr = np.asarray(y, dtype=int)
        raw_brier = float(brier_score_loss(y_arr, np.clip(p_raw, 0, 1)))

        # If the source probability has very few unique values, Platt
        # can't fit (it's a logistic on a 1-D input with fewer distinct
        # x's than samples) — fall back to the empirical-bin isotonic.
        uniq = np.unique(np.asarray(p_raw, dtype=float))
        if len(uniq) < 5:
            cal = cls._for_univariate(p_raw, y_arr)
            cal.calibrate_metrics(p_raw, y_arr)
            return cal

        platt = cls.platt(p_raw, y_arr)
        platt_pred = platt.predict(p_raw)
        platt_brier = float(brier_score_loss(y_arr, platt_pred))
        platt.calibrate_metrics(p_raw, y_arr)

        if n < min_isotonic_samples:
            logger.info(
                "Calibrator.auto: %d samples — Platt only (isotonic needs "
                ">%d). brier raw=%.4f platt=%.4f improvement=%.4f",
                n, min_isotonic_samples, raw_brier, platt_brier,
                raw_brier - platt_brier,
            )
            return platt

        iso = cls.isotonic(p_raw, y_arr)
        iso_pred = iso.predict(p_raw)
        iso_brier = float(brier_score_loss(y_arr, iso_pred))
        iso.calibrate_metrics(p_raw, y_arr)

        # Pick the lower-Brier winner
        winner = platt if platt_brier <= iso_brier else iso
        logger.info(
            "Calibrator.auto: n=%d brier raw=%.4f platt=%.4f iso=%.4f -> %s",
            n, raw_brier, platt_brier, iso_brier, winner.method,
        )
        return winner

    @classmethod
    def _for_univariate(cls, p_raw: np.ndarray, y: np.ndarray) -> "Calibrator":
        """When the source probability has very few unique values (e.g.
        a rule-based scorer that returns 0.10/0.45/0.85 only), Platt
        can't fit — it's literally a single point. In that case,
        bin-then-regress: replace each unique source probability with
        its empirical positive rate, then return the identity.
        """
        n = len(p_raw)
        uniq = np.unique(np.asarray(p_raw, dtype=float))
        if len(uniq) >= 5:
            return cls.identity()
        # Build empirical-lookup. Identity on the empirical mean of y
        # in each bin is one option, but the cleanest "univariate
        # calibrator" is just a dict of {p_value -> p_empirical}.
        # We can pack that into an IsotonicRegression with the unique
        # points as both X and y — its predict is monotone interpolation
        # between the empirical positives.
        from collections import defaultdict
        bins = defaultdict(list)
        for p, yi in zip(p_raw, y):
            bins[float(p)].append(int(yi))
        sorted_keys = sorted(bins)
        xs = np.array(sorted_keys, dtype=float)
        ys = np.array([np.mean(bins[k]) for k in sorted_keys], dtype=float)
        ir = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        ir.fit(xs, ys)
        cal = cls(method="isotonic", _model=ir, n_fit=n)
        logger.info(
            "Calibrator._for_univariate: %d unique probs (%s) — "
            "using empirical-bin isotonic.",
            len(uniq), uniq.tolist(),
        )
        return cal

    # ── Inference ──────────────────────────────────────────────────────

    def predict(self, p_raw: float | np.ndarray) -> float | np.ndarray:
        """Apply calibration. Identity passthrough if no model."""
        if self.method == "identity" or self._model is None:
            return p_raw
        p_arr = np.asarray(p_raw, dtype=float)
        if self.method == "platt":
            eps = 1e-6
            p_clip = np.clip(p_arr, eps, 1 - eps)
            logits = np.log(p_clip / (1 - p_clip)).reshape(-1, 1)
            out = self._model.predict_proba(logits)[:, 1]
            return float(out[0]) if np.isscalar(p_raw) else out
        elif self.method == "isotonic":
            out = self._model.predict(p_arr)
            return float(out) if np.isscalar(p_raw) else np.asarray(out)
        else:
            return p_raw

    # ── Diagnostics ────────────────────────────────────────────────────

    def calibrate_metrics(self, p_raw: np.ndarray, y: np.ndarray) -> None:
        """Record raw + calibrated Brier and ECE on the holdout."""
        y_arr = np.asarray(y, dtype=int)
        raw_clip = np.clip(p_raw, 0, 1)
        brier_raw = float(brier_score_loss(y_arr, raw_clip))
        cal_pred = self.predict(p_raw)
        brier_cal = float(brier_score_loss(y_arr, np.clip(cal_pred, 0, 1)))
        self.metrics = CalibrationMetrics(
            method=self.method,
            n_holdout=len(p_raw),
            brier_raw=brier_raw,
            brier_calibrated=brier_cal,
            improvement=brier_raw - brier_cal,
            ece_raw=_ece(raw_clip, y_arr),
            ece_calibrated=_ece(np.clip(cal_pred, 0, 1), y_arr),
        )

    # ── Persistence ────────────────────────────────────────────────────

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(self, f)
        logger.info("Saved calibrator to %s (method=%s, n_fit=%d)",
                    path, self.method, self.n_fit)

    @classmethod
    def load(cls, path: Path) -> "Calibrator | None":
        """Load a saved calibrator. Returns None if file missing/corrupt."""
        if not path.exists():
            return None
        try:
            with open(path, "rb") as f:
                cal = pickle.load(f)
            if not isinstance(cal, cls):
                logger.warning("%s did not contain a Calibrator (got %s)",
                               path, type(cal).__name__)
                return None
            return cal
        except Exception as exc:
            logger.warning("Failed to load calibrator from %s: %s", path, exc)
            return None

    def version_string(self) -> str:
        """Compact string for model_version / health endpoint."""
        if self.method == "identity":
            return "uncalibrated"
        if self.metrics is None:
            return f"calibrated-{self.method}"
        return (
            f"calibrated-{self.method}"
            f"(brier:{self.metrics.brier_raw:.3f}->{self.metrics.brier_calibrated:.3f},"
            f"ece:{self.metrics.ece_raw:.3f}->{self.metrics.ece_calibrated:.3f})"
        )


# ── Helper ─────────────────────────────────────────────────────────────────

def _ece(probs: np.ndarray, labels: np.ndarray, n_bins: int = 10) -> float:
    """Expected Calibration Error: weighted |acc − conf| across bins."""
    probs = np.asarray(probs, dtype=float)
    labels = np.asarray(labels, dtype=int)
    bins = np.linspace(0, 1, n_bins + 1)
    ece_val = 0.0
    n = len(labels)
    if n == 0:
        return 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (probs >= lo) & (probs < hi)
        if not mask.any():
            continue
        bin_acc = labels[mask].mean()
        bin_conf = probs[mask].mean()
        ece_val += (mask.sum() / n) * abs(bin_acc - bin_conf)
    return float(ece_val)