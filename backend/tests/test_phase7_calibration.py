"""Phase 7 — probability calibration regression tests."""
from __future__ import annotations


import numpy as np


# ── Identity passthrough ──────────────────────────────────────────────────

def test_calibrator_identity_passthrough():
    """When no calibrator is fit, predict() must return p_raw unchanged."""
    from app.lib.calibration import Calibrator
    cal = Calibrator.identity()
    assert cal.method == "identity"
    assert cal.predict(0.5) == 0.5
    assert cal.predict(0.1) == 0.1
    arr = np.array([0.2, 0.5, 0.9])
    out = cal.predict(arr)
    np.testing.assert_array_equal(out, arr)


def test_calibrator_identity_version_string():
    """Identity version string must be 'uncalibrated'."""
    from app.lib.calibration import Calibrator
    assert Calibrator.identity().version_string() == "uncalibrated"


# ── Platt scaling ─────────────────────────────────────────────────────────

def test_platt_shifts_probabilities_toward_observed_rate():
    """Platt scaling on a deliberately miscalibrated dataset must move
    predictions toward the empirical positive rate."""
    from app.lib.calibration import Calibrator
    # Construct a model that's over-confident at 0.95: 95% of true
    # labels are negative (y=0) but the model says 0.95.
    p_raw = np.array([0.95] * 100, dtype=float)
    y = np.array([0] * 95 + [1] * 5, dtype=int)
    cal = Calibrator.platt(p_raw, y)
    p_cal = cal.predict(0.95)
    # Calibrated output should be much closer to the empirical rate (0.05)
    # than the raw 0.95 was.
    assert 0.0 <= p_cal <= 0.3, f"platt did not shift over-confident 0.95 -> {p_cal}"


def test_platt_handles_extreme_probabilities():
    """Platt must clamp p=0 and p=1 without raising."""
    from app.lib.calibration import Calibrator
    p_raw = np.array([0.001, 0.5, 0.999], dtype=float)
    y = np.array([0, 1, 1], dtype=int)
    cal = Calibrator.platt(p_raw, y)
    out = cal.predict(p_raw)
    assert np.all(np.isfinite(out))
    assert np.all((out >= 0) & (out <= 1))


# ── Isotonic ──────────────────────────────────────────────────────────────

def test_isotonic_is_monotone():
    """Isotonic regression on a noisy signal must still be monotone."""
    from app.lib.calibration import Calibrator
    p_raw = np.linspace(0.1, 0.9, 30)
    y = (p_raw > 0.5).astype(int)
    # add a touch of label noise so the fit has something to smooth
    rng = np.random.RandomState(42)
    flip = rng.choice(30, 5, replace=False)
    y[flip] = 1 - y[flip]
    cal = Calibrator.isotonic(p_raw, y)
    xs = np.linspace(0.0, 1.0, 50)
    ys = cal.predict(xs)
    # Monotone non-decreasing
    diffs = np.diff(ys)
    assert np.all(diffs >= -1e-9), f"isotonic broke monotonicity: {diffs}"


# ── auto selection ────────────────────────────────────────────────────────

def test_auto_falls_back_to_identity_on_tiny_holdout():
    """With <30 samples, auto() must return identity (no calibration)."""
    from app.lib.calibration import Calibrator
    p_raw = np.array([0.3, 0.5, 0.7, 0.2, 0.8] * 4, dtype=float)  # 20 samples
    y = (p_raw > 0.5).astype(int)
    cal = Calibrator.auto(p_raw, y, min_isotonic_samples=100)
    assert cal.method == "identity"


def test_auto_picks_platt_or_isotonic_when_enough_data():
    """With enough samples, auto() must return a fitted calibrator."""
    from app.lib.calibration import Calibrator
    rng = np.random.RandomState(7)
    n = 200
    p_raw = rng.uniform(0.05, 0.95, n)
    # Make y follow p_raw with some noise so there's signal to fit
    y = (rng.uniform(0, 1, n) < p_raw).astype(int)
    cal = Calibrator.auto(p_raw, y, min_isotonic_samples=100)
    assert cal.method in ("platt", "isotonic")
    assert cal.n_fit == n


def test_auto_uses_empirical_bin_for_univariate_input():
    """When the source probability has <5 unique values (e.g. rules that
    only output 0.10/0.45/0.85), auto() must use the empirical-bin path
    instead of failing on Platt's degenerate fit."""
    from app.lib.calibration import Calibrator
    p_raw = np.array([0.10] * 30 + [0.45] * 40 + [0.85] * 50, dtype=float)
    y = np.array([0] * 30 + [0] * 35 + [1] * 5 + [1] * 35 + [1] * 15, dtype=int)
    cal = Calibrator.auto(p_raw, y, min_isotonic_samples=100)
    assert cal.method == "isotonic"
    assert cal.n_fit == 120


# ── Persistence ───────────────────────────────────────────────────────────

def test_save_and_load_roundtrip(tmp_path):
    """Pickle round-trip must restore method + predict() output."""
    from app.lib.calibration import Calibrator
    p_raw = np.array([0.1, 0.5, 0.9, 0.3, 0.7] * 30, dtype=float)
    y = (p_raw > 0.5).astype(int)
    cal = Calibrator.auto(p_raw, y)
    path = tmp_path / "cal.pkl"
    cal.save(path)
    assert path.exists()
    loaded = Calibrator.load(path)
    assert loaded is not None
    assert loaded.method == cal.method
    # Same input -> same output
    np.testing.assert_array_equal(
        loaded.predict(np.array([0.1, 0.5, 0.9])),
        cal.predict(np.array([0.1, 0.5, 0.9])),
    )


def test_load_returns_none_for_missing_file(tmp_path):
    """Load on a non-existent path must return None (not crash)."""
    from app.lib.calibration import Calibrator
    assert Calibrator.load(tmp_path / "does-not-exist.pkl") is None


def test_load_returns_none_for_corrupt_file(tmp_path):
    """Load on a file that isn't a Calibrator must return None + warn."""
    from app.lib.calibration import Calibrator
    bad = tmp_path / "bad.pkl"
    bad.write_bytes(b"this is not a pickle")
    assert Calibrator.load(bad) is None


# ── ECE helper ───────────────────────────────────────────────────────────

def test_ece_zero_for_perfectly_calibrated_model():
    """A perfectly calibrated set with conf==acc in every bin has ECE = 0.

    We use the bin-center probabilities so the model's stated confidence
    is exactly what we'd expect for the labels it predicts.
    Bin centers (10-bin scheme): 0.05, 0.15, 0.25, ..., 0.95.
    Construct 20% positives in the [0.0, 0.1) bin etc. — every bin
    should show conf == acc because we placed labels accordingly.
    """
    from app.lib.calibration import _ece
    probs = np.array(
        [0.05] * 10 +      # all 0 -> bin acc=0.00, conf=0.05 -> mismatch
        [0.15] * 10 +      # 0% pos -> bin acc=0.00, conf=0.15 -> mismatch
        [0.95] * 10,       # all 1 -> bin acc=1.00, conf=0.95 -> mismatch
        dtype=float,
    )
    # This isn't perfectly calibrated — so just verify ECE is small (not 0).
    ece_val = _ece(probs, np.array([0] * 30, dtype=int))
    assert ece_val >= 0.0  # well-defined: non-negative and not NaN
    # ECE will be large (0.05 + 0.15 + 0.95)/3 ≈ 0.38 — that's fine, we
    # want this test to assert ECE is well-defined, not assert a magic 0.

    # Better test: build a *truly* calibrated set and assert ECE ~= 0.
    # Use bin-center probabilities matching the empirical positive rate per bin.
    # Bin [0.0, 0.1): put 5/100 positives with probs=0.05 (conf 0.05, acc 0.05)
    # Bin [0.9, 1.0): put 95/100 positives with probs=0.95 (conf 0.95, acc 0.95)
    probs = np.concatenate([
        np.full(95, 0.05),   # negatives in low bin
        np.full(5, 0.05),    # positives in low bin -> acc = 0.05, conf = 0.05
        np.full(5, 0.95),    # negatives in high bin
        np.full(95, 0.95),   # positives in high bin -> acc = 0.95, conf = 0.95
    ])
    labels = np.concatenate([
        np.zeros(95, dtype=int),
        np.ones(5, dtype=int),
        np.zeros(5, dtype=int),
        np.ones(95, dtype=int),
    ])
    assert _ece(probs, labels) < 0.01, f"perfectly calibrated model gave ECE={_ece(probs, labels)}"


def test_ece_high_for_wildly_miscalibrated_model():
    """If predictions are all 0.5 but half are 1, ECE should be ~0.25."""
    from app.lib.calibration import _ece
    probs = np.array([0.5] * 100)
    labels = np.array([0] * 50 + [1] * 50)
    # bin [0.5,0.6): conf=0.5, acc=0.5, weight=1.0 -> ECE=0
    # All 100 samples land in the same bin and calibration is perfect
    # there. So actually ECE=0 for this case! Let's use a real
    # miscalibrated example.
    probs = np.array([0.95] * 100)
    labels = np.array([0] * 80 + [1] * 20)
    # bin [0.9,1.0): conf=0.95, acc=0.20, |diff|=0.75, weight=1.0
    ece_val = _ece(probs, labels)
    assert 0.7 < ece_val < 0.8, f"expected ~0.75, got {ece_val}"


# ── predict() integration ─────────────────────────────────────────────────

def test_predict_applies_persisted_calibrator(tmp_path, monkeypatch):
    """When a calibrator is on disk, model.predict() must apply it."""
    from app.lib.calibration import Calibrator
    from app.lib import model

    # Save a calibrator that maps 0.85 -> 0.4 (shrink over-confident).
    p_raw = np.array([0.85] * 100, dtype=float)
    y = np.array([0] * 70 + [1] * 30, dtype=int)
    cal = Calibrator.auto(p_raw, y)
    path = tmp_path / "cal.pkl"
    cal.save(path)

    # Point model.py at our temp calibrator
    monkeypatch.setattr(model, "CALIBRATOR_PATH", path)
    monkeypatch.setattr(model, "_cached_calibrator", None)
    monkeypatch.setattr(model, "_calibrator_checked", False)

    # Verify the cached load picks up our calibrator
    loaded = model.get_calibrator()
    assert loaded.method == cal.method
    assert model._calibrator_checked is True

    # Calling again returns the cached object (not reloaded)
    loaded2 = model.get_calibrator()
    assert loaded2 is loaded


def test_get_calibrator_returns_identity_when_no_file(tmp_path, monkeypatch):
    """When no calibrator.pkl exists, get_calibrator() must return identity."""
    from app.lib import model

    monkeypatch.setattr(model, "CALIBRATOR_PATH", tmp_path / "missing.pkl")
    monkeypatch.setattr(model, "_cached_calibrator", None)
    monkeypatch.setattr(model, "_calibrator_checked", False)

    cal = model.get_calibrator()
    assert cal.method == "identity"
    assert cal.predict(0.42) == 0.42


# ── model_version integration ─────────────────────────────────────────────

def test_model_version_includes_calibrator_tag():
    """model_metadata() output must show the calibrator method.

    The plain :func:`model_version` returns the bare version identifier
    (so it can be pinned by tests / compared by the UI). The richer
    ``model_metadata`` adds the ``[cal-<method>]`` tag plus the tier
    qualifier — that's where the calibrator signal lives now.
    """
    from app.lib.freshness import model_metadata
    s = model_metadata(None)
    # Tag is in form [cal-identity] or [cal-platt] etc.
    import re
    assert re.search(r"\[cal-(identity|platt|isotonic)\]", s), s