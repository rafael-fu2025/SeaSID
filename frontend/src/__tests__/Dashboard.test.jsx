import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import Dashboard from '@/pages/Dashboard';

// Mock the API so the loading skeleton is observable. SiteSelector
// needs getSites, Dashboard itself calls getForecast + getAlerts.
// ActiveLearningNudge calls /alerts/learning so we mock it too.
vi.mock('@/api', () => ({
  api: {
    getSites:    vi.fn(() => Promise.resolve([])),
    getForecast: vi.fn(() => new Promise(() => {})),
    getAlerts:   vi.fn(() => new Promise(() => {})),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Dashboard />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('Dashboard — loading skeleton mirrors the actual container order', () => {
  it('renders the KPI strip, chart, provenance, forecast grid, optimal window, and footer skeletons in the post-swap order', () => {
    renderDashboard();

    const kpi = screen.getByTestId('skeleton-kpi-strip');
    const chart = screen.getByTestId('skeleton-chart');
    const prov = screen.getByTestId('skeleton-provenance');
    const grid = screen.getByTestId('skeleton-forecast-grid');
    const optimal = screen.getByTestId('skeleton-optimal-window');
    const footer = screen.getByTestId('skeleton-footer');

    [kpi, chart, prov, grid, optimal, footer].forEach((el) => {
      expect(el).toBeInTheDocument();
    });

    // The KPI strip should default to 5 cards (matches the real Dashboard).
    const kpiCards = kpi.querySelectorAll(':scope > div');
    expect(kpiCards.length).toBe(5);

    // The forecast grid should default to 12 cards (matches one page).
    const gridCards = grid.querySelectorAll(':scope > div');
    expect(gridCards.length).toBe(12);

    // Document order: kpi < chart < prov < grid < optimal < footer.
    const position = (el) =>
      Array.from(document.body.querySelectorAll('*')).indexOf(el);
    expect(position(kpi)).toBeLessThan(position(chart));
    expect(position(chart)).toBeLessThan(position(prov));
    expect(position(prov)).toBeLessThan(position(grid));
    expect(position(grid)).toBeLessThan(position(optimal));
    expect(position(optimal)).toBeLessThan(position(footer));
  });

  it('renders the KPI skeleton with the same column count as the real KPI strip (lg:grid-cols-5)', () => {
    renderDashboard();
    const kpi = screen.getByTestId('skeleton-kpi-strip');
    expect(kpi.className).toMatch(/lg:grid-cols-5/);
  });
});
