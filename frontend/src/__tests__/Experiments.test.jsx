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
  },
}));

function renderExperiments() {
  return render(
    <MemoryRouter><Experiments /></MemoryRouter>,
  );
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
    expect(headers).toContain('accuracy');
    expect(headers).toContain('precision');
    expect(headers).toContain('recall');
    expect(headers).toContain('f1');
    expect(headers).toContain('auc_roc');
  });
});
