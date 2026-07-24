import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MapPage from '../pages/MapPage';
import { api } from '../api';

// Stub Leaflet so the component is testable in jsdom (which has no canvas/
// google-maps-style drawing). We only assert that the page mounts and
// surfaces the site list + skeleton + leaflet container.
vi.mock('leaflet', () => ({
  default: {
    map: () => ({
      fitBounds: () => {},
      remove: () => {},
      on: () => {},
      off: () => {},
      invalidateSize: () => {},
      scrollWheelZoom: { enable: () => {}, disable: () => {} },
      doubleClickZoom: { enable: () => {}, disable: () => {} },
      boxZoom: { enable: () => {}, disable: () => {} },
      touchZoom: { enable: () => {}, disable: () => {} },
      dragging: { enable: () => {}, disable: () => {} },
    }),
    tileLayer: () => ({ addTo: () => {} }),
    layerGroup: () => ({ addTo: () => ({ clearLayers: () => {}, addTo: () => {} }), clearLayers: () => {} }),
    circle: () => ({ addTo: () => ({ setRadius: () => {} }), setRadius: () => {} }),
    marker: () => ({
      bindTooltip: () => ({ bindPopup: () => ({ addTo: () => {} }), addTo: () => {} }),
      bindPopup: () => ({ addTo: () => {} }),
      addTo: () => {},
    }),
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
    // The leaflet container sits inside an absolute-positioned wrapper that
    // is itself inside the Card. The Card owns the `relative z-0` stacking
    // context that keeps Leaflet's panes below the Sheet backdrop.
    const cardWithZ0 = container.closest('[class*="z-0"]');
    expect(cardWithZ0).not.toBeNull();
    expect(cardWithZ0).toHaveClass('relative');

    // The sheet is an overlay, not a layout resize. Opening it must not
    // alter the Leaflet container or trigger its expensive tile repaint.
    act(() => {
      window.dispatchEvent(new CustomEvent('seasid:agent-sheet', { detail: { open: true } }));
    });
    expect(container.className).toBe(initialClassName);
    expect(container).not.toHaveAttribute('aria-hidden');
  });

  it('shows a click-to-enable overlay by default and hides it after the user opts in', async () => {
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    const overlay = await screen.findByTestId('map-enable-overlay');
    expect(overlay).toBeInTheDocument();
    expect(overlay.getAttribute('aria-label')).toMatch(/enable map zoom/i);

    // Opting in should remove the overlay and surface the lock toggle.
    fireEvent.click(overlay);
    await waitFor(() => {
      expect(screen.queryByTestId('map-enable-overlay')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('map-lock-toggle')).toBeInTheDocument();
  });

  it('re-enables the click-to-enable overlay when the user locks the map', async () => {
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    const overlay = await screen.findByTestId('map-enable-overlay');
    fireEvent.click(overlay);
    const lockToggle = await screen.findByTestId('map-lock-toggle');
    fireEvent.click(lockToggle);
    await waitFor(() => {
      expect(screen.getByTestId('map-enable-overlay')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('map-lock-toggle')).not.toBeInTheDocument();
  });

  it('renders the lock toggle with a Lucide Lock icon and "Lock map" label (no emoji)', async () => {
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    const overlay = await screen.findByTestId('map-enable-overlay');
    fireEvent.click(overlay);
    const lockToggle = await screen.findByTestId('map-lock-toggle');
    // Lucide icons render as <svg> elements with the `lucide` class.
    const lockIcon = lockToggle.querySelector('svg.lucide-lock');
    expect(lockIcon).not.toBeNull();
    // The label is plain text; no lock/padlock emoji character survives.
    expect(lockToggle.textContent).toMatch(/Lock map/);
    expect(lockToggle.textContent).not.toMatch(/[\u{1F512}\u{1F513}]/u);
  });

  it('re-fetches every site forecast when the global seasid:refresh event fires', async () => {
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId('map-site-list')).toBeInTheDocument();
    });
    const callsBefore = api.getForecast.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    // Swap the forecast mock to a different payload so we can prove the
    // refresh burst landed a second fetch.
    api.getForecast.mockResolvedValueOnce({
      hours: [
        { ts: '2026-07-09T01:00:00+00:00', p_bad: 0.92, viz_label: 'Poor', current_risk: 'High', risk: 'HIGH' },
      ],
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('seasid:refresh'));
    });

    // Two sites × at least two fetches each (mount + refresh).
    await waitFor(() => {
      expect(api.getForecast.mock.calls.length).toBeGreaterThan(callsBefore + 1);
    });
  });
});
