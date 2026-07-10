import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import App from '@/App';

vi.mock('@/api', () => ({
  api: {
    getSites: vi.fn().mockResolvedValue([]),
    getForecast: vi.fn().mockResolvedValue({
      site_key: 'dauin_muck',
      site_name: 'Dauin Muck',
      hours: [],
      optimal_window: null,
    }),
    getAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
    getBriefing: vi.fn().mockResolvedValue({ response: '', tool_calls: [] }),
    chat: vi.fn(),
    getLabels: vi.fn().mockResolvedValue({ labels: [] }),
    getExperimentResults: vi.fn().mockResolvedValue({}),
    health: vi.fn().mockResolvedValue({ status: 'ok', providers: {} }),
  },
}));

describe('App routing', () => {
  it('renders the cockpit shell (brand, nav, FAB, status bar) on /', async () => {
    // Wipe layout prefs so this test isn't sensitive to leftover
    // localStorage from a prior session.
    try {
      localStorage.removeItem('seasid.cockpit.leftCollapsed');
      localStorage.removeItem('seasid.cockpit.rightCollapsed');
      localStorage.removeItem('seasid.cockpit.v3');
    } catch {}
    window.history.pushState({}, '', '/');
    render(
      <TooltipProvider>
        <App />
      </TooltipProvider>,
    );
    // Brand chip — the NavLink has aria-label "SeaSID — go to Dashboard".
    expect(screen.getByLabelText(/SeaSID/i)).toBeInTheDocument();
    // Dashboard heading
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    // Floating AI button
    expect(screen.getByTestId('agent-fab')).toBeInTheDocument();
    // Status bar present
    expect(screen.getByTestId('status-clock')).toBeInTheDocument();
    // Palette trigger
    expect(screen.getByTestId('open-palette')).toBeInTheDocument();
  });
});
