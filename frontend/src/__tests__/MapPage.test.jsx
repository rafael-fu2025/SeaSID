import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MapPage from '../pages/MapPage';
import { api } from '../api';

// Stub Leaflet so the component is testable in jsdom (which has no canvas/
// google-maps-style drawing). We only assert that the page mounts and
// surfaces the site list + skeleton + leaflet container.
vi.mock('leaflet', () => ({
  default: {
    map: () => ({ fitBounds: () => {}, remove: () => {}, on: () => {}, invalidateSize: () => {} }),
    tileLayer: () => ({ addTo: () => {} }),
    layerGroup: () => ({ addTo: () => ({ clearLayers: () => {}, addTo: () => {} }), clearLayers: () => {} }),
    circle: () => ({ addTo: () => {} }),
    marker: () => ({ bindPopup: () => ({ addTo: () => {} }) }),
  },
}));

vi.mock('../api', () => ({
  api: {
    getSites: vi.fn(),
    getForecast: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.getSites.mockResolvedValue([
    { key: 'dauin_muck', name: 'Dauin Muck Bays', lat: 9.1844, lon: 123.2678, type: 'muck', description: 'world-class muck diving' },
    { key: 'apo_reef',   name: 'Apo Island Reef',   lat: 9.0671, lon: 123.2737, type: 'reef', description: 'marine sanctuary' },
  ]);
  api.getForecast.mockResolvedValue({
    hours: [
      { ts: '2026-07-09T00:00:00+00:00', p_bad: 0.18, viz_label: 'Good', current_risk: 'Low', risk: 'LOW' },
    ],
  });
});

describe('Map page', () => {
  it('renders the page header and the leaflet map container', () => {
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /^map$/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('leaflet-map')).toBeInTheDocument();
  });

  it('shows skeleton placeholders while sites are loading', () => {
    api.getSites.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    expect(screen.getByTestId('map-skeleton-list')).toBeInTheDocument();
  });

  it('renders a card per registered site after data resolves', async () => {
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId('map-site-list')).toBeInTheDocument();
    });
    expect(screen.getByText(/Dauin Muck Bays/)).toBeInTheDocument();
    expect(screen.getByText(/Apo Island Reef/)).toBeInTheDocument();
  });

  it('shows a banner with the error message when sites fail to load', async () => {
    api.getSites.mockRejectedValue(new Error('network down'));
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });

  it('keeps Leaflet intact when the agent Sheet opens', () => {
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    const container = screen.getByTestId('leaflet-map');
    const initialClassName = container.className;
    // The enclosing card creates a low stacking context, keeping Leaflet's
    // high-z-index panes below the agent Sheet backdrop.
    expect(container.closest('[class*="relative"]')).toHaveClass('z-0');

    // The sheet is an overlay, not a layout resize. Opening it must not
    // alter the Leaflet container or trigger its expensive tile repaint.
    act(() => {
      window.dispatchEvent(new CustomEvent('seasid:agent-sheet', { detail: { open: true } }));
    });
    expect(container.className).toBe(initialClassName);
    expect(container).not.toHaveAttribute('aria-hidden');
  });
});
