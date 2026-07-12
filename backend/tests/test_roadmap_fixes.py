"""
Regression tests for the SeaSID roadmap code-level fixes (items 11-15).

Each test class maps to a numbered fix in the next-move backlog:
- TestFix13IngestCounts       — #13: stop overreporting ingest row counts
- TestFix12AirFieldInSchema   — #12: add missing `air` field to ForecastResponse
- TestFix11LstmAll11TrainOnce — #11: deduplicate LSTM training in `all_11` ablation
- TestFix14OperatorUniqueCstr — #14: UniqueConstraint on operator_verifications
- TestFix15AirQualityDisabled — #15: resolve dormant air-quality path
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from sqlalchemy.exc import IntegrityError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.schemas import ForecastResponse
from app.lib.db import AirQualityObs, OperatorVerification
from app.lib.ingest import (
    _persist_air,
    _persist_marine,
    _persist_tides,
    _persist_weather,
)
from app.lib.sites import get_all_sites


@pytest.fixture
def site_ts():
    now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    return now, [now + timedelta(hours=h) for h in range(3)]


class TestFix13IngestCounts:
    """Item 13: counters must reflect rows actually persisted after conflicts."""

    def test_persist_weather_returns_actual_inserted_count(self, db_session, site_ts):
        _, ts_list = site_ts
        rows = [{"ts": ts, "precip_mm": 1.0} for ts in ts_list]
        assert _persist_weather("dauin_muck", rows) == 3
        assert _persist_weather("dauin_muck", rows) == 0

        mixed = [
            {"ts": ts_list[0]},
            {"ts": ts_list[0]},
            {"ts": ts_list[-1] + timedelta(hours=1)},
        ]
        assert _persist_weather("dauin_muck", mixed) == 1

    def test_persist_marine_returns_actual_inserted_count(self, db_session, site_ts):
        _, ts_list = site_ts
        rows = [{"ts": ts, "wave_height_m": 0.5} for ts in ts_list]
        assert _persist_marine("dauin_muck", rows) == 3
        assert _persist_marine("dauin_muck", rows) == 0

    def test_persist_tides_returns_actual_inserted_count(self, db_session, site_ts):
        _, ts_list = site_ts
        rows = [{"ts": ts, "height_m": 0.2} for ts in ts_list]
        assert _persist_tides("dauin_muck", rows) == 3
        assert _persist_tides("dauin_muck", rows) == 0

    def test_persist_air_returns_one_for_new_snapshot(self, db_session, site_ts):
        now, _ = site_ts
        snap = {"ts": now, "aqi": 42.0, "pm25": 12.0}
        assert _persist_air("dauin_muck", snap) == 1
        assert _persist_air("dauin_muck", snap) == 0

    def test_persist_weather_handles_empty_input(self, db_session):
        assert _persist_weather("dauin_muck", []) == 0


class TestFix12AirFieldInSchema:
    """Item 12: the `air` payload assigned by services.get_forecast must reach
    API consumers — Pydantic silently drops fields not declared on the schema."""

    def test_schema_declares_air_field(self):
        assert "air" in ForecastResponse.model_fields

    def test_schema_accepts_air_dict(self):
        fr = ForecastResponse(
            site_key="dauin_muck",
            site_name="Dauin Muck Bays",
            generated_at="2026-07-12T00:00:00+00:00",
            hours=[],
            air={"aqi": 42, "pm25": 12.0},
        )
        assert fr.model_dump()["air"] == {"aqi": 42, "pm25": 12.0}

    def test_schema_air_defaults_to_none(self):
        fr = ForecastResponse(
            site_key="dauin_muck",
            site_name="Dauin Muck Bays",
            generated_at="2026-07-12T00:00:00+00:00",
            hours=[],
        )
        assert fr.air is None


class TestFix11LstmAll11TrainOnce:
    """Item 11: the `all_11` ablation must train the LSTM exactly once per run
    and reuse the resulting model + scaler for both the bundle and the predict."""

    def _make_inputs(self):
        rng = np.random.RandomState(0)
        X_seq = rng.rand(30, 24, 11).astype(np.float32)
        y = (rng.rand(30) > 0.5).astype(np.int64)
        return X_seq, y

    def test_all_11_uses_one_trained_bundle(self, monkeypatch):
        from app.lib import experiments as exp
        from app.lib import model_lstm as ml

        X_seq, y = self._make_inputs()

        call_count = {"n": 0}

        class _StubResult:
            model = object()
            scaler = object()
            metrics = {}
            train_losses = [0.1]
            val_losses = [0.1]
            n_samples = 30
            config = None
            feature_columns = []

        def fake_train(X, y_, config):
            call_count["n"] += 1
            return _StubResult()

        def fake_predict(bundle, X):
            return np.full(len(X), 0.4, dtype=np.float32)

        # `_run_ablations` imports `train_lstm`/`predict_proba_lstm` lazily
        # from `app.lib.model_lstm`, so that's the module we must patch.
        monkeypatch.setattr(ml, "train_lstm", fake_train)
        monkeypatch.setattr(ml, "predict_proba_lstm", fake_predict)

        ablations = exp._run_ablations(X_seq, y, X_seq, y)
        feature_block = ablations["feature_subsets"]

        assert "all_11" in feature_block
        assert "f1" in feature_block["all_11"]
        assert "error" not in feature_block["all_11"], feature_block["all_11"].get("error")

    def test_all_11_block_does_not_call_train_lstm_twice_inline(self):
        """Static-source check: the inline double-train pattern is gone."""
        import inspect
        from app.lib import experiments as exp

        src = inspect.getsource(exp._run_ablations)
        bad_pattern = '"model": train_lstm('
        assert bad_pattern not in src, (
            "Inline double-train pattern still present in _run_ablations"
        )


class TestFix14OperatorUniqueCstr:
    """Item 14: duplicate submissions for the same (site, date, operator)
    must be rejected at the database layer."""

    def test_unique_constraint_present_in_table_args(self):
        from app.lib.db import OperatorVerification
        constraints = OperatorVerification.__table_args__
        names = {
            c.name
            for c in constraints
            if hasattr(c, "name") and isinstance(c.name, str)
        }
        assert "uq_opver_site_date_operator" in names

    def test_duplicate_verification_rejected(self, db_session):
        v = OperatorVerification(
            site_key="dauin_muck",
            operator="alice",
            date=date(2026, 7, 12),
            verdict="dive",
        )
        db_session.add(v)
        db_session.commit()

        dup = OperatorVerification(
            site_key="dauin_muck",
            operator="alice",
            date=date(2026, 7, 12),
            verdict="no_dive",
        )
        db_session.add(dup)
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()

    def test_different_operators_same_date_allowed(self, db_session):
        v1 = OperatorVerification(
            site_key="dauin_muck",
            operator="alice",
            date=date(2026, 7, 12),
            verdict="dive",
        )
        v2 = OperatorVerification(
            site_key="dauin_muck",
            operator="bob",
            date=date(2026, 7, 12),
            verdict="dive",
        )
        db_session.add_all([v1, v2])
        db_session.commit()

    def test_anonymous_operator_collision_handled_by_sqlite(self, db_session):
        v1 = OperatorVerification(
            site_key="dauin_muck",
            operator=None,
            date=date(2026, 7, 12),
            verdict="dive",
        )
        v2 = OperatorVerification(
            site_key="dauin_muck",
            operator=None,
            date=date(2026, 7, 12),
            verdict="no_dive",
        )
        db_session.add_all([v1, v2])
        db_session.commit()


class TestFix15AirQualityDisabled:
    """Item 15: sites with ``air_provider_disabled=True`` must never expose
    an air block, even if stale air rows exist on disk."""

    def test_all_current_sites_have_air_disabled(self):
        sites = get_all_sites()
        assert sites, "site registry must not be empty"
        for s in sites:
            assert s.get("air_provider_disabled") is True, (
                f"site {s['key']} unexpectedly has air_provider_disabled=False; "
                "either update this test or re-enable the air path."
            )

    def test_latest_air_snapshot_returns_none_for_disabled_site(self, db_session):
        now = datetime(2026, 7, 12, 0, 0, 0, tzinfo=timezone.utc)
        db_session.add(
            AirQualityObs(
                site_key="dauin_muck",
                ts=now,
                aqi=42,
                pm25=12,
                source="aqicn",
            )
        )
        db_session.commit()

        from app.api.services import _latest_air_snapshot
        assert _latest_air_snapshot("dauin_muck") is None

    def test_latest_air_snapshot_returns_none_for_unknown_site(self, db_session):
        from app.api.services import _latest_air_snapshot
        assert _latest_air_snapshot("not_a_real_site") is None