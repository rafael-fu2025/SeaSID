import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    getAgentTools: vi.fn().mockResolvedValue({
      tools: [],
      mcp: { status: 'unavailable', server: 'minimax', tools: [] },
    }),
    me: vi.fn(),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    listApiKeys: vi.fn().mockResolvedValue({ keys: [], providers: {} }),
    revealApiKey: vi.fn().mockResolvedValue({
      id: 1, provider: 'llm', label: 'primary', value: 'sk-secret', value_preview: '••••cret',
    }),
    updateProviderConfig: vi.fn().mockResolvedValue({
      config: { provider: 'llm', base_url: null },
    }),
  },
}));

function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  try {
    localStorage.removeItem('seasid.cockpit.leftCollapsed');
    localStorage.removeItem('seasid.cockpit.rightCollapsed');
    localStorage.removeItem('seasid.cockpit.v3');
    localStorage.removeItem('seasid.authToken');
  } catch {}
});

describe('App routing', () => {
  it('renders the cockpit shell (brand, nav, FAB, status bar, UserMenu) on /', async () => {
    window.history.pushState({}, '', '/');
    renderApp();
    expect(screen.getByLabelText(/SeaSID/i)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByTestId('agent-fab')).toBeInTheDocument();
    expect(screen.getByTestId('status-clock')).toBeInTheDocument();
    expect(screen.getByTestId('status-foundation')).toBeInTheDocument();
    // UserMenu trigger is in the sidebar header (always above the fold).
    expect(screen.getByTestId('user-menu-trigger')).toBeInTheDocument();
  });

  it('renders the Profile page at /profile', async () => {
    try { localStorage.setItem('seasid.authToken', 'test-token'); } catch {}
    const { api } = await import('@/api');
    api.me = vi.fn().mockResolvedValue({
      username: 'admin', role: 'admin', site_keys: ['*'], subject: 'admin',
    });
    window.history.pushState({}, '', '/profile');
    renderApp();
    expect(await screen.findByRole('heading', { name: /profile/i })).toBeInTheDocument();
    expect(screen.getByTestId('profile-identity')).toBeInTheDocument();
  });

  it('renders role-aware Settings tabs without the right inspector rail', async () => {
    const user = userEvent.setup();
    try { localStorage.setItem('seasid.authToken', 'test-token'); } catch {}
    const { api } = await import('@/api');
    api.me = vi.fn().mockResolvedValue({
      username: 'admin', role: 'admin', site_keys: ['*'], subject: 'admin',
    });
    api.listUsers = vi.fn().mockResolvedValue({ users: [
      { id: 1, username: 'admin', role: 'admin', site_keys: ['*'],
        subject: 'admin', enabled: true, last_login_at: null },
    ] });
    window.history.pushState({}, '', '/settings');
    renderApp();
    expect(await screen.findByTestId('settings-admin-sections')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-agent')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-users')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-api-keys')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-about')).toBeInTheDocument();
    expect(screen.queryByTestId('right-rail')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('settings-tab-users'));
    expect(await screen.findByTestId('admin-users')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-appearance')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('settings-tab-api-keys'));
    expect(await screen.findByTestId('admin-api-keys')).toBeInTheDocument();
  });

  it('merges Agent settings and renders tools in an accordion', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/settings');
    renderApp();
    await user.click(await screen.findByTestId('settings-tab-agent'));
    expect(screen.getByTestId('settings-agent')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tools')).toBeInTheDocument();
    // New layout: tools live in a Radix accordion, not a table.
    expect(screen.getByTestId('tools-accordion')).toBeInTheDocument();
    expect(screen.queryByTestId('tools-table')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Description' })).not.toBeInTheDocument();
    // Each tool name from the registry should appear as its own row.
    for (const name of [
      'get_forecast', 'get_weather', 'list_sites',
      'get_model_info', 'get_history', 'check_alerts',
      'get_air_quality',
    ]) {
      expect(screen.getByTestId(`tool-row-${name}`)).toBeInTheDocument();
    }
  });

  it('reveals and copies an API key only after an admin action', async () => {
    const user = userEvent.setup();
    const { api } = await import('@/api');
    api.listApiKeys = vi.fn().mockResolvedValue({
      keys: [{
        id: 1,
        provider: 'llm',
        label: 'primary',
        value_preview: '••••cret',
        enabled: true,
        total_uses: 0,
        last_used_at: null,
        last_error: null,
        cooldown_until: null,
      }],
      providers: { llm: { label: 'LLM provider', count: 1, enabled: 1 } },
    });
    api.revealApiKey = vi.fn().mockResolvedValue({
      id: 1,
      provider: 'llm',
      label: 'primary',
      value: 'sk-full-secret',
      value_preview: '••••cret',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    window.history.pushState({}, '', '/settings');
    renderApp();
    await user.click(await screen.findByTestId('settings-tab-api-keys'));
    await user.click(await screen.findByTestId('admin-api-keys-reveal'));

    expect(await screen.findByText('sk-full-secret')).toBeInTheDocument();
    expect(api.revealApiKey).toHaveBeenCalledWith(1);
    await user.click(screen.getByTestId('admin-api-keys-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('sk-full-secret'));
  });
});
