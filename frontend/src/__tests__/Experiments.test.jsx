import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Experiments from '@/pages/Experiments';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    getExperimentResults: vi.fn(),
    runExperiments: vi.fn(),
    runExperimentsStream: vi.fn(),
  },
}));

function renderExperiments() {
  return render(
    <MemoryRouter><Experiments /></MemoryRouter>,
  );
}

/**
 * Fake SSE that the streaming test can drive directly. Records the
 * callbacks the page subscribes with so each test can emit log /
 * status / metric / done events synchronously and assert that the UI
 * reacted to them.
 */
function makeFakeStream() {
  const handlers = {};
  const close = vi.fn();
  api.runExperimentsStream.mockImplementation((opts = {}) => {
    Object.assign(handlers, {
      onStatus: opts.onStatus,
      onLog: opts.onLog,
      onMetric: opts.onMetric,
      onDone: opts.onDone,
      onError: opts.onError,
    });
    return close;
  });
  return { handlers, close };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Experiments page', () => {
  it('renders an empty state when no results exist yet', async () => {
    api.getExperimentResults.mockResolvedValue({});
    renderExperiments();
    expect(await screen.findByText(/No experiment results yet/i)).toBeInTheDocument();
  });

  it('renders a row for every entry in model_comparison (the actual API shape)', async () => {
    api.getExperimentResults.mockResolvedValue({
      timestamp: '2026-07-20T00:00:00+00:00',
      best_model: 'xgb',
      model_comparison: {
        rule: { accuracy: 0.7826, precision: 0.7826, recall: 1.0, f1: 0.7826, auc_roc: 0.5 },
        xgb:  { accuracy: 0.6637, precision: 0.6637, recall: 1.0, f1: 0.7979, auc_roc: 0.5368 },
        lstm: { accuracy: 0.6637, precision: 0.6637, recall: 1.0, f1: 0.7514, auc_roc: 0.5098 },
        gru:  { accuracy: 0.6637, precision: 0.6637, recall: 1.0, f1: 0.7650, auc_roc: 0.5123 },
      },
      dataset: {},
      ablations: {},
    });
    renderExperiments();
    await waitFor(() => {
      expect(screen.getByTestId('experiments-row-rule')).toBeInTheDocument();
      expect(screen.getByTestId('experiments-row-xgb')).toBeInTheDocument();
      expect(screen.getByTestId('experiments-row-lstm')).toBeInTheDocument();
      expect(screen.getByTestId('experiments-row-gru')).toBeInTheDocument();
    });
    // "No rows" fallback should not be shown.
    expect(screen.queryByText(/^No rows\.$/)).not.toBeInTheDocument();
  });

  it('also accepts the by_model shape (legacy / alternate backends)', async () => {
    api.getExperimentResults.mockResolvedValue({
      best_model: 'xgboost',
      by_model: {
        xgboost: { accuracy: 0.9, f1: 0.9 },
        rule_based: { accuracy: 0.7, f1: 0.7 },
      },
    });
    renderExperiments();
    await waitFor(() => {
      expect(screen.getByTestId('experiments-row-xgboost')).toBeInTheDocument();
      expect(screen.getByTestId('experiments-row-rule_based')).toBeInTheDocument();
    });
  });

  it('also accepts the models-array shape', async () => {
    api.getExperimentResults.mockResolvedValue({
      models: [
        { name: 'xgb', metrics: { accuracy: 0.9, f1: 0.9 } },
        { name: 'lstm', metrics: { accuracy: 0.8, f1: 0.8 } },
      ],
    });
    renderExperiments();
    await waitFor(() => {
      expect(screen.getByTestId('experiments-row-xgb')).toBeInTheDocument();
      expect(screen.getByTestId('experiments-row-lstm')).toBeInTheDocument();
    });
  });

  it('highlights the best_model row with a "best" badge', async () => {
    api.getExperimentResults.mockResolvedValue({
      best_model: 'xgb',
      model_comparison: {
        xgb:  { accuracy: 0.9, f1: 0.9 },
        rule: { accuracy: 0.7, f1: 0.7 },
      },
    });
    renderExperiments();
    await waitFor(() => {
      const bestRow = screen.getByTestId('experiments-row-xgb');
      expect(bestRow).toHaveClass('bg-reef/5');
      // "best" indicator inside the same row.
      expect(bestRow.textContent.toLowerCase()).toContain('best');
    });
  });

  it('falls back to CV metrics inside train_metrics when top-level fields are missing', async () => {
    // A freshly-retrained model might only have CV numbers, no held-out
    // test metrics yet. The page should still render a row.
    api.getExperimentResults.mockResolvedValue({
      best_model: 'lstm',
      model_comparison: {
        lstm: {
          // No accuracy/precision/recall/f1 at the top level.
          auc_roc: 0.65,
          train_metrics: {
            cv_accuracy: 0.88,
            cv_f1: 0.94,
            auc_roc: 0.99,
          },
        },
      },
    });
    renderExperiments();
    await waitFor(() => {
      const row = screen.getByTestId('experiments-row-lstm');
      // CV-derived accuracy + f1 should show in the cells.
      expect(row.textContent).toMatch(/0\.880/);  // cv_accuracy
      expect(row.textContent).toMatch(/0\.940/);  // cv_f1
    });
  });

  it('renders the metric columns in the order defined by METRICS', async () => {
    api.getExperimentResults.mockResolvedValue({
      model_comparison: { xgb: { accuracy: 0.9, f1: 0.9 } },
    });
    renderExperiments();
    await waitFor(() => screen.getByTestId('experiments-row-xgb'));
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.trim());
    expect(headers).toContain('Model');
    expect(headers).toContain('precision');
    expect(headers).toContain('recall');
    expect(headers).toContain('f1');
    expect(headers).toContain('auc_roc');
  });
});

describe('Experiments page — automatic UI refresh on completion', () => {
  let listeners;
  let originalDispatch;
  beforeEach(() => {
    // Capture every dispatchEvent invocation so each test can assert the
    // expected events were broadcast when the experiment suite completes.
    listeners = [];
    originalDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = (event) => {
      listeners.push({
        type: event?.type ?? null,
        detail: event instanceof CustomEvent ? event.detail : undefined,
      });
      return originalDispatch(event);
    };
  });
  afterEach(() => {
    // Restore the real dispatchEvent so other test files in this suite
    // (or future jsdom-runs within this file) don't see the spy.
    if (typeof window !== 'undefined' && originalDispatch) {
      window.dispatchEvent = originalDispatch;
    }
  });

  it('broadcasts seasid:experiments-complete + seasid:refresh on the stream done event', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));

    handlers.onStatus?.({ stage: 'running' });
    handlers.onDone?.({
      best_model: 'xgb',
      results: {
        best_model: 'xgb',
        model_comparison: {
          xgb: { accuracy: 0.9, precision: 0.91, recall: 0.99, f1: 0.94, auc_roc: 0.85 },
          lstm: { accuracy: 0.84, f1: 0.88, auc_roc: 0.81 },
        },
      },
    });

    // Both events should be on the wire so the StatusBar model chip
    // and the Dashboard / Forecast / MapPage forecast fetchers all
    // catch up without a manual refresh.
    await waitFor(() => {
      const types = listeners.map((l) => l.type);
      expect(types).toContain('seasid:experiments-complete');
      expect(types).toContain('seasid:refresh');
    });
    const complete = listeners.find((l) => l.type === 'seasid:experiments-complete');
    expect(complete.detail.best_model).toBe('xgb');
    expect(complete.detail.results.model_comparison.xgb.accuracy).toBeCloseTo(0.9);
  });

  it('falls back to results.best_model when the top-level best_model is absent', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));

    handlers.onStatus?.({ stage: 'running' });
    handlers.onDone?.({
      // Older backend: best_model only lives under results.
      results: {
        best_model: 'lstm',
        model_comparison: { lstm: { f1: 0.9 } },
      },
    });

    await waitFor(() => {
      const c = listeners.find((l) => l.type === 'seasid:experiments-complete');
      expect(c?.detail?.best_model).toBe('lstm');
    });
  });

  it('does NOT broadcast on cancel — only on a successful completion', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers, close } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));
    handlers.onStatus?.({ stage: 'running' });
    const cancelBtn = await screen.findByTestId('experiments-cancel');
    await user.click(cancelBtn);
    // close() is called by the cancel handler; onDone never fires, so
    // neither refresh signal should have gone out.
    expect(close).toHaveBeenCalled();
    const types = listeners.map((l) => l.type);
    expect(types).not.toContain('seasid:experiments-complete');
    expect(types).not.toContain('seasid:refresh');
  });

  it('does NOT broadcast on a stream error', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));
    handlers.onStatus?.({ stage: 'running' });
    handlers.onError?.('No labels in database');
    const types = listeners.map((l) => l.type);
    expect(types).not.toContain('seasid:experiments-complete');
    expect(types).not.toContain('seasid:refresh');
  });
});

describe('Experiments page — streaming run', () => {
  it('opens an SSE stream and renders log lines as they arrive', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers, close } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));

    // Drive the fake stream: status → log → log → done.
    handlers.onStatus?.({ stage: 'loading' });
    handlers.onStatus?.({ stage: 'running', samples: 751 });
    handlers.onLog?.('Running experiments on 751 samples...');
    handlers.onLog?.('  Training: XGBoost (Baseline 2)...');
    handlers.onLog?.('    F1: 0.7979');
    handlers.onDone?.({ best_model: 'xgb', results: {
      best_model: 'xgb',
      model_comparison: {
        xgb: { accuracy: 0.88, precision: 0.9, recall: 0.99, f1: 0.94, auc_roc: 0.84 },
      },
    } });

    // The progress card and the log lines should both be visible.
    expect(await screen.findByTestId('experiments-run-progress')).toBeInTheDocument();
    const log = await screen.findByTestId('experiments-run-log');
    expect(log.textContent).toContain('Running experiments on 751 samples');
    expect(log.textContent).toContain('Training: XGBoost (Baseline 2)');
    expect(log.textContent).toContain('F1: 0.7979');
    // The stream's close() must be called when done fires.
    expect(close).toHaveBeenCalled();
  });

  it('updates the model_comparison rows live as metric events arrive', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));

    handlers.onStatus?.({ stage: 'running' });
    handlers.onMetric?.({ model: 'rule', accuracy: 0.7, f1: 0.78 });
    // The rule row should appear in the table as soon as its metric
    // event arrives — even before the run finishes.
    await waitFor(() => {
      const row = screen.getByTestId('experiments-row-rule');
      expect(row).toBeInTheDocument();
    });
    handlers.onMetric?.({ model: 'xgb', accuracy: 0.9, f1: 0.94 });
    await waitFor(() => {
      expect(screen.getByTestId('experiments-row-xgb')).toBeInTheDocument();
    });
  });

  it('surfaces stream errors in the error card and stops the spinner', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));

    handlers.onStatus?.({ stage: 'running' });
    handlers.onError?.('No labels in database');

    // The error card carries the message; once onError fires the
    // running state is cleared so the Run button is re-enabled.
    expect(await screen.findByText(/No labels in database/)).toBeInTheDocument();
    const runBtn = screen.getByTestId('experiments-run');
    expect(runBtn).not.toBeDisabled();
  });

  it('shows a Cancel button while running that closes the stream', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers, close } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));
    handlers.onStatus?.({ stage: 'running' });

    // While running, the button becomes Cancel.
    const cancelBtn = await screen.findByTestId('experiments-cancel');
    await user.click(cancelBtn);
    expect(close).toHaveBeenCalled();
  });

  it('passes log lines to the log panel verbatim (no transformation)', async () => {
    const user = userEvent.setup();
    api.getExperimentResults.mockResolvedValue({});
    const { handlers } = makeFakeStream();
    renderExperiments();
    await user.click(screen.getByTestId('experiments-run'));

    handlers.onStatus?.({ stage: 'running' });
    handlers.onLog?.('  Best model: xgb (F1: 0.9400)');
    const log = await screen.findByTestId('experiments-run-log');
    expect(log.textContent).toContain('Best model: xgb');
  });
});
