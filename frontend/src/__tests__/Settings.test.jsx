import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/theme/ThemeContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import Settings from '@/pages/Settings';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: { getSites: vi.fn(), health: vi.fn(), getAgentTools: vi.fn() },
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
  // Default: the agent-tools endpoint is unavailable so the static
  // registry stays the source of truth. Individual tests can override
  // with mockResolvedValueOnce to exercise the live-merge path.
  api.getAgentTools.mockResolvedValue({
    tools: [],
    mcp: { status: 'unavailable', server: 'minimax', tools: [] },
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

async function openTab(testId) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(testId));
}

describe('Settings page', () => {
  it('renders tab navigation and switches from Appearance to Agent', async () => {
    renderSettings();
    expect(screen.getByTestId('settings-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-agent')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-agent')).not.toBeInTheDocument();
    await openTab('settings-tab-agent');
    expect(screen.getByTestId('settings-agent')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tools')).toBeInTheDocument();
  });

  it('does not render the duplicate user-identity / Sign out block in the page header', () => {
    renderSettings();
    const h1 = screen.getByRole('heading', { level: 1, name: /^settings$/i });
    const header = h1.closest('header');
    expect(header).not.toBeNull();
    // The "admin · admin" style identity text and the inline Sign out
    // button were removed from the page header; sign-out lives in the
    // sidebar UserMenu dropdown instead.
    expect(header.textContent).not.toMatch(/·\s*admin/);
    expect(within(header).queryByRole('button', { name: /sign out/i })).toBeNull();
  });

  it('renders the tools accordion with all seven v2.1 entries', async () => {
    renderSettings();
    await openTab('settings-tab-agent');
    const accordion = screen.getByTestId('tools-accordion');
    expect(accordion).toBeInTheDocument();
    [
      'get_forecast', 'get_weather', 'list_sites',
      'get_model_info', 'get_history', 'check_alerts',
      'get_air_quality',
    ].forEach((name) => {
      expect(screen.getByTestId(`tool-row-${name}`)).toBeInTheDocument();
    });
    // No table; the description is now in a collapsed row + expanded panel.
    expect(screen.queryByTestId('tools-table')).not.toBeInTheDocument();
    // Each row shows a one-line preview (truncated at 120 chars + ellipsis)
    // so the full description isn't dumped into the trigger.
    const trigger = screen.getByTestId('tool-row-get_forecast').querySelector('button');
    const preview = trigger.textContent.replace(/…$/, '').trim();
    // The full description is longer than 120 chars and ends in "…";
    // the preview line itself is short.
    expect(preview.length).toBeLessThan(160);
    expect(preview).toMatch(/parameter/i);
  });

  it('expands a tool row to reveal its full description and parameters', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openTab('settings-tab-agent');
    const row = screen.getByTestId('tool-row-get_forecast');
    // Trigger is the first button inside the row.
    const trigger = row.querySelector('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    // Radix updates aria-expanded synchronously; the description sits in
    // a <p> inside the content panel which is in the DOM after the click.
    await waitFor(() => {
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });
    // The full (un-truncated) description appears inside the panel.
    const full = row.textContent;
    expect(full).toMatch(/Returns the current dive-condition forecast and risk assessment/i);
    // site_key is a required parameter on get_forecast; check it appears
    // inside the now-expanded content panel.
    expect(row.textContent).toMatch(/site_key/);
  });

  it('toggles a tool off without expanding the row', async () => {
    const user = userEvent.setup();
    renderSettings();
    await openTab('settings-tab-agent');
    const toggle = screen.getByTestId('tool-toggle-get_forecast');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('surfaces live data-source providers from /api/v1/health', async () => {
    api.health.mockResolvedValueOnce({
      status: 'ok', version: '2.1.0', model_loaded: 'lstm',
      providers: { weather: 'open_meteo', marine: 'stormglass', air: 'aqicn' },
    });
    renderSettings();
    await openTab('settings-tab-about');
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
    await openTab('settings-tab-about');
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

  it('toggles a tool off when its switch is clicked', async () => {
    renderSettings();
    await openTab('settings-tab-agent');
    const sw = screen.getByTestId('tool-toggle-get_forecast');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    const user = userEvent.setup();
    await user.click(sw);
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
import { within } from '@testing-library/react';
