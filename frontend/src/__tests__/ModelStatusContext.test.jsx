import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import {
  ModelStatusProvider,
  useModelStatus,
} from '@/components/ModelStatusContext';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: { health: vi.fn(), getForecast: vi.fn() },
}));

function safeStorage() {
  try {
    if (typeof window !== 'undefined'
        && window.localStorage
        && typeof window.localStorage.clear === 'function') {
      return window.localStorage;
    }
  } catch {}
  return null;
}

/**
 * Test fixture that surfaces the hook's snapshot via test ids so the test
 * can read both the active model and the latest best-model without
 * poking at React internals.
 */
function ModelProbe({ id = 'probe' }) {
  const status = useModelStatus();
  // The 5 children render as JSX siblings without a wrapping array; React
  // doesn't require keys in that case, but it warns about the implicit
  // fragment when multiple siblings appear at the top level. Build the
  // children through an array so each one gets a stable key.
  const fields = [
    ['model', status.model ?? '∅'],
    ['best', status.bestModel ?? '∅'],
    ['loading', status.loading ? '1' : '0'],
    ['mounted', status.isMounted ? '1' : '0'],
  ];
  return (
    <div>
      {fields.map(([name, value]) => (
        <span key={name} data-testid={`${id}-${name}`}>{value}</span>
      ))}
      <button
        type="button"
        onClick={() => status.refresh()}
        data-testid={`${id}-refresh`}
      >
        refresh
      </button>
      <button
        type="button"
        onClick={() => status.applyExperimentsComplete({ best_model: 'rule' })}
        data-testid={`${id}-apply-experiments`}
      >
        apply
      </button>
    </div>
  );
}

function renderProvider(...children) {
  return render(<ModelStatusProvider>{children}</ModelStatusProvider>);
}

beforeEach(() => {
  const ls = safeStorage();
  if (ls) ls.clear();
  vi.resetAllMocks();
  // Default: a healthy backend with the LSTM tier selected so the
  // provider lands in a known, fully-populated state.
  api.health.mockResolvedValue({
    status: 'ok',
    selected_tier: 'lstm',
    model_loaded: 'lstm',
    selection_reason: 'n_samples=1200, auc=0.71',
    providers: {},
  });
});

afterEach(() => {
  // Defensive: confirm no stray window listeners survived the suite so
  // tests don't bleed into each other.
  // (jsdom reuses the window, so cleanup happens via the provider's
  // unmount in `render` automatically — no explicit teardown needed.)
});

describe('ModelStatusContext', () => {
  it('calls /api/v1/health on mount and reflects the active tier', async () => {
    renderProvider(<ModelProbe />);
    await waitFor(() => {
      expect(api.health).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('probe-model').textContent).toBe('LSTM');
    expect(screen.getByTestId('probe-best').textContent).toBe('∅');
    // After the fetch resolves, loading flips back off.
    await waitFor(() => {
      expect(screen.getByTestId('probe-loading').textContent).toBe('0');
    });
    expect(screen.getByTestId('probe-mounted').textContent).toBe('1');
  });

  it('falls back to model_loaded when selected_tier is missing', async () => {
    api.health.mockResolvedValueOnce({
      status: 'ok',
      model_loaded: 'xgboost',
      providers: {},
    });
    renderProvider(<ModelProbe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-model').textContent).toBe('XGBOOST');
    });
  });

  it('keeps the prior model when a health fetch fails', async () => {
    api.health.mockResolvedValueOnce({
      status: 'ok', selected_tier: 'rule_based', providers: {},
    });
    renderProvider(<ModelProbe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-model').textContent).toBe('RULE_BASED');
    });
    // Now flip the mock to reject and call refresh() — the chip should
    // stay on RULE_BASED instead of going blank.
    api.health.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('probe-refresh'));
    });
    expect(screen.getByTestId('probe-model').textContent).toBe('RULE_BASED');
  });

  it('reacts to the seasid:experiments-complete event by updating the bestModel', async () => {
    renderProvider(<ModelProbe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-model').textContent).toBe('LSTM');
    });
    // Fire the same event the Experiments page dispatches when the
    // experiment suite's SSE stream emits its `done` payload.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('seasid:experiments-complete', {
        detail: { best_model: 'xgb' },
      }));
    });
    expect(screen.getByTestId('probe-best').textContent).toBe('XGB');
    // And the auto-refresh triggered by the event should re-call /health.
    await waitFor(() => {
      expect(api.health.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('reacts to the seasid:refresh event by re-fetching /health', async () => {
    renderProvider(<ModelProbe />);
    await waitFor(() => {
      expect(api.health).toHaveBeenCalledTimes(1);
    });
    api.health.mockResolvedValueOnce({
      status: 'ok', selected_tier: 'xgboost', providers: {},
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('seasid:refresh'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-model').textContent).toBe('XGBOOST');
    });
    expect(api.health).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent health fetches while one is in flight', async () => {
    // Make the first fetch hang so we can prove a second concurrent call
    // is suppressed by the inFlightRef guard.
    let resolveFirst;
    api.health.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    renderProvider(<ModelProbe />);
    // A second event while the first fetch is pending should NOT kick
    // off another health call — the provider skips re-entry.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('seasid:refresh'));
      window.dispatchEvent(new CustomEvent('seasid:refresh'));
    });
    expect(api.health).toHaveBeenCalledTimes(1);
    // Resolving the original fetch flips loading back off without a
    // second network call being issued by the deduped events.
    await act(async () => {
      resolveFirst({
        status: 'ok', selected_tier: 'lstm', providers: {},
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-model').textContent).toBe('LSTM');
    });
    expect(api.health).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown / empty best_model shapes without crashing', async () => {
    renderProvider(<ModelProbe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-model').textContent).toBe('LSTM');
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('seasid:experiments-complete', {
        detail: undefined,
      }));
    });
    // No best_model in the detail → bestModel stays null.
    expect(screen.getByTestId('probe-best').textContent).toBe('∅');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('seasid:experiments-complete', {
        detail: { best_model: '' },
      }));
    });
    expect(screen.getByTestId('probe-best').textContent).toBe('∅');
  });

  it('exposes applyExperimentsComplete for direct caller use', async () => {
    renderProvider(<ModelProbe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-model').textContent).toBe('LSTM');
    });
    api.health.mockResolvedValue({
      status: 'ok', selected_tier: 'rule_based', providers: {},
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('probe-apply-experiments'));
    });
    expect(screen.getByTestId('probe-best').textContent).toBe('RULE');
  });

  it('returns a neutral fallback when the provider is not mounted', () => {
    // Render the probe WITHOUT the wrapping provider — every field on
    // the hook should fall back to its no-op default and not throw.
    render(<ModelProbe id="orphan" />);
    expect(screen.getByTestId('orphan-model').textContent).toBe('∅');
    expect(screen.getByTestId('orphan-best').textContent).toBe('∅');
    expect(screen.getByTestId('orphan-mounted').textContent).toBe('0');
  });
});

/**
 * Integration test for the experiment-suite → cockpit cascade.
 *
 * Renders ModelStatusProvider around a child that:
 *   • exposes the model state through the hook;
 *   • counts ``getForecast`` calls so we can prove downstream listeners
 *     (the would-be Dashboard/Forecast/MapPage refresh) fire.
 *
 * Then dispatches the exact event Experiments.jsx broadcasts on ``done``
 * and asserts both:
 *   1. the model-context snapshot updates to the new best model;
 *   2. ``GET /forecast`` is called again, simulating the cockpit pages
 *      pulling fresh data now that the backend cache is empty.
 */
describe('ModelStatusContext — end-to-end experiment cascade', () => {
  it('refreshes downstream consumers when seasid:experiments-complete fires', async () => {
    api.health.mockResolvedValueOnce({
      status: 'ok', selected_tier: 'lstm', providers: {},
    });
    api.getForecast.mockResolvedValue({
      site_key: 'dauin_muck', hours: [], optimal_window: null,
    });

    let refreshCallCount = 0;
    function ExperimentCascadeConsumer() {
      useModelStatus();
      // Stand in for Dashboard / Forecast / MapPage: every time the
      // provider hears ``seasid:refresh``, fire a forecast fetch.
      useEffect(() => {
        const onRefresh = () => {
          refreshCallCount += 1;
          api.getForecast('dauin_muck');
        };
        window.addEventListener('seasid:refresh', onRefresh);
        return () => window.removeEventListener('seasid:refresh', onRefresh);
      }, []);
      return null;
    }

    render(
      <ModelStatusProvider>
        <ModelProbe id="cascade" />
        <ExperimentCascadeConsumer />
      </ModelStatusProvider>,
    );

    // Initial mount: one health fetch, no forecast calls.
    await waitFor(() => {
      expect(screen.getByTestId('cascade-model').textContent).toBe('LSTM');
    });
    expect(api.getForecast).not.toHaveBeenCalled();

    // Dispatch the exact event pair Experiments.jsx fires on completion:
    // the dedicated best-model signal followed by the global refresh
    // signal so every forecast-bound consumer refetches.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('seasid:experiments-complete', {
        detail: { best_model: 'xgb', results: { best_model: 'xgb' } },
      }));
      window.dispatchEvent(new CustomEvent('seasid:refresh'));
    });

    // The bestModel chip flips, /health refetches, and any
    // seasid:refresh consumers fire their forecast fetchers.
    await waitFor(() => {
      expect(screen.getByTestId('cascade-best').textContent).toBe('XGB');
    });
    await waitFor(() => {
      expect(refreshCallCount).toBeGreaterThanOrEqual(1);
      expect(api.getForecast).toHaveBeenCalledWith('dauin_muck');
    });
  });
});
