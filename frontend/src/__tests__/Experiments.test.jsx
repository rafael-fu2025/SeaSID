import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Experiments, { normalizeExperimentResults } from '@/pages/Experiments';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    getExperimentResults: vi.fn(),
    runExperiments: vi.fn(),
  },
}));

const RESULTS = {
  dataset: { total_samples: 181, test_size: 27 },
  model_comparison: {
    rule: { accuracy: 0.963, precision: 0.963, recall: 1, f1: 0.981, auc_roc: null },
    xgb: { accuracy: 0.519, precision: 1, recall: 0.5, f1: 0.667, auc_roc: 0.885 },
  },
  best_model: 'rule',
};

describe('Experiments page', () => {
  it('normalizes the backend model_comparison response', () => {
    const normalized = normalizeExperimentResults({ status: 'success', results: RESULTS });
    expect(normalized.rows).toHaveLength(2);
    expect(normalized.rows[0]).toMatchObject({ name: 'rule', f1: 0.981 });
  });

  it('renders the current backend experiment result shape', async () => {
    api.getExperimentResults.mockResolvedValue(RESULTS);
    render(<Experiments />);

    await waitFor(() => expect(screen.getAllByText('Rule baseline').length).toBeGreaterThan(0));
    expect(screen.getByTestId('experiments-table')).toBeInTheDocument();
    expect(screen.getByText('XGBoost')).toBeInTheDocument();
    expect(screen.getByText(/27 test samples/i)).toBeInTheDocument();
  });
});
