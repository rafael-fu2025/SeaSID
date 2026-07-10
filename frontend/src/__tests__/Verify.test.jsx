import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Verify from '../pages/Verify';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getSites: vi.fn(),
    getLabels: vi.fn(),
    verify: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.getSites.mockResolvedValue([
    { key: 'dauin_muck', name: 'Dauin Muck Bays', type: 'muck' },
    { key: 'apo_reef', name: 'Apo Island Reef', type: 'reef' },
  ]);
  api.getLabels.mockResolvedValue({ labels: [] });
});

describe('Verify page', () => {
  it('renders every required field', () => {
    render(<MemoryRouter><Verify /></MemoryRouter>);
    expect(screen.getByLabelText(/operator name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^date$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/actual visibility/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/actual current/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/comments/i)).toBeInTheDocument();
  });

  it('renders three verdict radio buttons', () => {
    render(<MemoryRouter><Verify /></MemoryRouter>);
    expect(screen.getByDisplayValue('dive')).toBeInTheDocument();
    expect(screen.getByDisplayValue('poor_viz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('no_dive')).toBeInTheDocument();
  });

  it('renders a submit button', () => {
    render(<MemoryRouter><Verify /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('shows an empty-state when there are no recent observations', async () => {
    render(<MemoryRouter><Verify /></MemoryRouter>);
    expect(await screen.findByText(/no observations yet/i)).toBeInTheDocument();
  });
});
