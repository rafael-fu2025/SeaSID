import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import Verify from '@/pages/Verify';
import { api } from '@/api';

vi.mock('@/api', () => ({
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
  api.getLabels.mockResolvedValue({
    labels: [
      { date: '2026-07-09', site_key: 'dauin_muck', label: 'dive', actual_viz_m: 12, source: 'operator_a' },
    ],
  });
});

function renderVerify() {
  return render(
    <TooltipProvider>
      <Verify />
    </TooltipProvider>,
  );
}

describe('Verify page (form lives in a Dialog)', () => {
  it('does NOT render the form by default — only the + New observation trigger', () => {
    renderVerify();
    // Header is always rendered
    expect(screen.getByRole('heading', { name: /operator verification/i })).toBeInTheDocument();
    // Trigger button is present
    expect(screen.getByTestId('verify-new')).toBeInTheDocument();
    // Form fields are NOT in the DOM yet
    expect(screen.queryByLabelText(/^site$/i)).toBeNull();
    expect(screen.queryByLabelText(/operator name/i)).toBeNull();
    expect(screen.queryByLabelText(/^date$/i)).toBeNull();
    expect(screen.queryByLabelText(/actual current/i)).toBeNull();
    expect(screen.queryByLabelText(/actual visibility/i)).toBeNull();
    expect(screen.queryByLabelText(/comments/i)).toBeNull();
  });

  it('opens the dialog with all required fields when New observation is clicked', async () => {
    renderVerify();
    fireEvent.click(screen.getByTestId('verify-new'));

    // Dialog title (DialogTitle renders as an h2)
    expect(await screen.findByRole('heading', { name: 'New observation' })).toBeInTheDocument();
    expect(screen.getByText(/all fields except comments are required/i)).toBeInTheDocument();

    // Form fields appear
    expect(screen.getByLabelText(/^site$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/operator name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^date$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/actual current/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/actual visibility/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/comments/i)).toBeInTheDocument();
  });

  it('exposes three verdict radio buttons inside the dialog', async () => {
    renderVerify();
    fireEvent.click(screen.getByTestId('verify-new'));

    expect(await screen.findByDisplayValue('dive')).toBeInTheDocument();
    expect(screen.getByDisplayValue('poor_viz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('no_dive')).toBeInTheDocument();
  });

  it('renders the submit + cancel buttons inside the dialog', async () => {
    renderVerify();
    fireEvent.click(screen.getByTestId('verify-new'));

    expect(await screen.findByTestId('verify-submit')).toBeInTheDocument();
    expect(screen.getByTestId('verify-cancel')).toBeInTheDocument();
  });

  it('closes the dialog when Cancel is clicked', async () => {
    renderVerify();
    fireEvent.click(screen.getByTestId('verify-new'));

    const cancel = await screen.findByTestId('verify-cancel');
    fireEvent.click(cancel);

    await waitFor(() => {
      expect(screen.queryByTestId('verify-submit')).toBeNull();
    });
  });

  it('shows empty-state when there are no recent observations', async () => {
    api.getLabels.mockResolvedValue({ labels: [] });
    renderVerify();
    expect(await screen.findByText(/no observations yet/i)).toBeInTheDocument();
  });
});
