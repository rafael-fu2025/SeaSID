import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/theme/ThemeContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import Settings from '@/pages/Settings';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: { getSites: vi.fn(), health: vi.fn() },
}));

beforeEach(() => {
  try { window.localStorage.clear(); } catch {}
  vi.resetAllMocks();
  api.getSites.mockResolvedValue([
    { key: 'dauin_muck', name: 'Dauin Muck Bays', type: 'muck' },
    { key: 'apo_reef',   name: 'Apo Island Reef',   type: 'reef' },
  ]);
  api.health.mockResolvedValue({
    status: 'ok',
    version: '2.1.0',
    model_loaded: 'lstm',
    providers: { weather: 'open_meteo', marine: 'open_meteo' },
  });
});

function renderSettings() {
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <MemoryRouter><Settings /></MemoryRouter>
      </TooltipProvider>
    </ThemeProvider>,
  );
}

describe('Settings page', () => {
  it('renders the three sections: Appearance, Agent, Tools', () => {
    renderSettings();
    expect(screen.getByTestId('settings-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-agent')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tools')).toBeInTheDocument();
  });

  it('renders the tools table with all seven v2.1 entries', () => {
    renderSettings();
    const table = screen.getByTestId('tools-table');
    expect(table).toBeInTheDocument();
    [
      'get_forecast', 'get_weather', 'list_sites',
      'get_model_info', 'get_history', 'check_alerts',
      'get_air_quality',
    ].forEach((name) => {
      expect(table.textContent).toContain(name);
    });
  });

  it('surfaces live data-source providers from /api/v1/health', async () => {
    api.health.mockResolvedValueOnce({
      status: 'ok', version: '2.1.0', model_loaded: 'lstm',
      providers: { weather: 'open_meteo', marine: 'stormglass', air: 'aqicn' },
    });
    renderSettings();
    expect(await screen.findByTestId('settings-providers')).toBeInTheDocument();
    expect(screen.getByTestId('provider-status-weather').textContent).toMatch(/default/i);
    expect(screen.getByTestId('provider-status-marine').textContent).toMatch(/custom/i);
    expect(screen.getByTestId('provider-status-air').textContent).toMatch(/custom/i);
    // Provider names appear in the rendered cards as well
    const providerCard = screen.getByTestId('settings-providers');
    expect(providerCard.textContent).toContain('open_meteo');
    expect(providerCard.textContent).toContain('stormglass');
    expect(providerCard.textContent).toContain('aqicn');
  });

  it('shows the air provider as not-configured when omitted from health', async () => {
    api.health.mockResolvedValueOnce({
      status: 'ok', version: '2.1.0', model_loaded: 'lstm',
      providers: { weather: 'open_meteo', marine: 'open_meteo' },
    });
    renderSettings();
    expect(await screen.findByTestId('settings-providers')).toBeInTheDocument();
    expect(screen.getByTestId('provider-status-air').textContent).toMatch(/not configured/i);
  });

  it('shows Light / Dark toggle, defaulting to dark', () => {
    renderSettings();
    const dark = screen.getByTestId('theme-dark');
    const light = screen.getByTestId('theme-light');
    // Active state is on the dark button (aria-selected)
    expect(dark.getAttribute('aria-selected')).toBe('true');
    expect(light.getAttribute('aria-selected')).toBe('false');
  });

  it('switches to light when the Light pill is clicked', () => {
    renderSettings();
    act(() => {
      fireEvent.click(screen.getByTestId('theme-light'));
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('theme-light').getAttribute('aria-selected')).toBe('true');
  });

  it('toggles a tool off when its switch is clicked', () => {
    renderSettings();
    const sw = screen.getByTestId('tool-toggle-get_forecast');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('defaults the theme to dark even if no storage entry exists', () => {
    // jsdom storage may be unavailable in some sandboxed environments
    // (vitest emits `--localstorage-file` warnings); the durable
    // assertion is that the dark tab is the active default.
    renderSettings();
    expect(screen.getByTestId('theme-dark').getAttribute('aria-selected')).toBe('true');
  });
});
