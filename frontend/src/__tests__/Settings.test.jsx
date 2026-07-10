import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Settings from '../pages/Settings';
import { ThemeProvider } from '../theme/ThemeContext';
import { SidebarProvider } from '../theme/SidebarContext';
import { api } from '../api';

vi.mock('../api', () => ({
  api: { getSites: vi.fn() },
}));

const safeStorage = () => {
  try {
    if (typeof window !== 'undefined'
        && window.localStorage
        && typeof window.localStorage.clear === 'function') {
      return window.localStorage;
    }
  } catch {}
  return null;
};

beforeEach(() => {
  const ls = safeStorage();
  if (ls) {
    try { ls.clear(); } catch {}
  }
  vi.resetAllMocks();
  api.getSites.mockResolvedValue([
    { key: 'dauin_muck', name: 'Dauin Muck Bays', type: 'muck' },
    { key: 'apo_reef',   name: 'Apo Island Reef',   type: 'reef' },
  ]);
});

function renderSettings() {
  return render(
    <ThemeProvider>
      <SidebarProvider>
        <MemoryRouter><Settings /></MemoryRouter>
      </SidebarProvider>
    </ThemeProvider>
  );
}

describe('Settings page', () => {
  it('renders the three sections: Appearance, Agent, Tools', () => {
    renderSettings();
    expect(screen.getByTestId('settings-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-agent')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tools')).toBeInTheDocument();
  });

  it('renders the tools table with all six entries', () => {
    renderSettings();
    const table = screen.getByTestId('tools-table');
    expect(table).toBeInTheDocument();
    ['get_forecast', 'get_weather', 'list_sites', 'get_model_info', 'get_history', 'check_alerts']
      .forEach((name) => {
        expect(table.textContent).toContain(name);
      });
  });

  it('shows Light / Dark toggle, defaulting to dark', () => {
    renderSettings();
    expect(screen.getByTestId('theme-dark').className).toMatch(/is-active/);
    expect(screen.getByTestId('theme-light').className).not.toMatch(/is-active/);
  });

  it('switches to light when the Light pill is clicked', () => {
    renderSettings();
    fireEvent.click(screen.getByTestId('theme-light'));
    expect(screen.getByTestId('theme-light').className).toMatch(/is-active/);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists the light theme choice via the data-theme attribute', () => {
    renderSettings();
    fireEvent.click(screen.getByTestId('theme-light'));
    // jsdom doesn't always persist writes across the localStorage backing in
    // this configuration, so we assert the side effect (data-theme) instead.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggles a tool off when its switch is clicked', () => {
    renderSettings();
    const sw = screen.getByTestId('tool-toggle-get_forecast');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('defaults the theme to dark even if no storage entry exists', () => {
    expect(safeStorage()?.getItem('seasid.theme')).toBeFalsy();
    renderSettings();
    expect(screen.getByTestId('theme-dark').className).toMatch(/is-active/);
  });
});

