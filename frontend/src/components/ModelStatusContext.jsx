import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { api } from '@/api';

/**
 * ModelStatusContext — single source of truth for "which model is live now?".
 *
 * Two pieces of state flow through this provider so the cockpit shell
 * stays in sync after the experiment suite trains a new best model:
 *
 *   ``model``      — the model tier the backend is *currently* serving
 *                    forecasts from (e.g. ``"lstm"``, ``"xgboost"``,
 *                    ``"rule_based"``). Refreshed by ``GET /api/v1/health``.
 *                    This is also the value the Dashboard "Model in use"
 *                    KPI and the ForecastProvenance strip display, but
 *                    they derive it from the live forecast payload — the
 *                    StatusBar uses this provider to avoid a second
 *                    network round-trip on every page.
 *
 *   ``bestModel``  — the model the latest experiment run selected (e.g.
 *                    ``"xgb"`` / ``"lstm"`` / ``"rule"`` / ``"gru"``).
 *                    Pushed by the Experiments page when the suite's
 *                    SSE `done` event fires, via a ``seasid:experiments-complete``
 *                    window event. Until the first experiment run this
 *                    stays ``null`` and the consumer falls back to
 *                    ``model``.
 *
 * Both are refreshed when the global ``seasid:refresh`` event fires —
 * Dashboard / Forecast / MapPage already dispatch that to refetch their
 * own data, so we piggy-back on it instead of inventing yet another
 * refresh channel.
 *
 * The provider is mounted once in ``main.jsx`` so every page (and the
 * StatusBar in the layout chrome) shares the same cached value. If a
 * component renders outside the provider — typically only in unit tests —
 * ``useModelStatus`` returns a neutral fallback instead of throwing, so
 * existing Layout tests keep working.
 */

const ModelStatusContext = createContext(null);

const FALLBACK = Object.freeze({
  model: null,
  bestModel: null,
  loading: false,
  isMounted: false,
  refresh: () => {},
  applyExperimentsComplete: () => {},
});

const EXPERIMENTS_COMPLETE_EVENT = 'seasid:experiments-complete';
const REFRESH_EVENT = 'seasid:refresh';

/**
 * Pretty-print a backend health ``selected_tier`` so the StatusBar's
 * compact 8-char footprint stays readable. Backend values come back as
 * ``"lstm"`` / ``"xgboost"`` / ``"rule_based"``; this normalises the
 * mixed casing and trims the verbose ``xgboost`` to ``"xgb"`` only when
 * the chip needs it.
 */
function formatModelLabel(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

export function ModelStatusProvider({ children }) {
  const [model, setModel] = useState(null);
  const [bestModel, setBestModel] = useState(null);
  const [loading, setLoading] = useState(true);
  // Track in-flight refreshes so rapid event bursts (e.g. an experiment
  // run + a manual ⌘K refresh within the same tick) don't pile up identical
  // ``GET /health`` requests. Refs survive re-renders without retriggering
  // effects the way updating state would.
  const inFlightRef = useRef(false);

  const fetchModel = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const health = await api.health();
      // /api/v1/health surfaces ``selected_tier`` (lowercased short id like
      // ``"lstm"`` / ``"xgboost"`` / ``"rule_based"``) and ``model_loaded``
      // (same value, kept for back-compat with the existing Settings page).
      // Prefer ``selected_tier`` — it's the tier gate output from
      // ``app.lib.model.selected_tier`` and matches what the Dashboard's
      // "Model in use" KPI ends up displaying.
      const tier = formatModelLabel(health?.selected_tier || health?.model_loaded);
      if (tier) setModel(tier);
    } catch (err) {
      // Silently stay on the previous model — the StatusBar already shows
      // ``—`` when nothing has loaded, and a transient backend hiccup
      // shouldn't blank the chrome.
      console.debug('ModelStatus: health fetch failed', err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  /**
   * Apply the ``best_model`` from a completed experiment run. Called
   * directly by the Experiments page after its SSE ``done`` event, and
   * indirectly via the ``seasid:experiments-complete`` window event for
   * any consumer mounted later (e.g. the Settings page reopens after the
   * run finished — we still want it to see the new model).
   */
  const applyExperimentsComplete = useCallback((detail) => {
    const next = formatModelLabel(detail?.best_model);
    if (next) setBestModel(next);
  }, []);

  // Initial fetch on mount, then subscribe to the two events that should
  // bump the cached model state.
  useEffect(() => {
    fetchModel();

    const onRefresh = () => { fetchModel(); };
    const onExperimentsComplete = (event) => {
      applyExperimentsComplete(event?.detail);
      // The backend already reloaded the ML bundle and invalidated every
      // site's forecast cache in ``/api/v1/experiments/run``. A fresh
      // ``/health`` round-trip is the cleanest way to learn which tier
      // the gate now selects — the experiment's winner may not actually
      // qualify its tier gate (e.g. n_samples < LSTM_MIN_SAMPLES), in
      // which case the chip should reflect the *active* tier, not just
      // the *winner*.
      fetchModel();
    };

    window.addEventListener(REFRESH_EVENT, onRefresh);
    window.addEventListener(EXPERIMENTS_COMPLETE_EVENT, onExperimentsComplete);
    return () => {
      window.removeEventListener(REFRESH_EVENT, onRefresh);
      window.removeEventListener(EXPERIMENTS_COMPLETE_EVENT, onExperimentsComplete);
    };
  }, [applyExperimentsComplete, fetchModel]);

  const value = useMemo(() => ({
    model,
    bestModel,
    loading,
    isMounted: true,
    refresh: fetchModel,
    applyExperimentsComplete,
  }), [model, bestModel, loading, fetchModel, applyExperimentsComplete]);

  return (
    <ModelStatusContext.Provider value={value}>
      {children}
    </ModelStatusContext.Provider>
  );
}

/**
 * ``useModelStatus`` — read the current / best model from context.
 *
 * Returns a frozen fallback object when the provider is missing so that
 * individual components (e.g. the StatusBar under a Layout-only render
 * during unit tests) can render safely without each test wrapping in a
 * fresh provider.
 */
export function useModelStatus() {
  const ctx = useContext(ModelStatusContext);
  return ctx ?? FALLBACK;
}

export default ModelStatusProvider;
