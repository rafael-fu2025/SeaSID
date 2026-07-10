import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { SidebarProvider, useSidebar } from '../theme/SidebarContext';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  if (typeof document !== 'undefined') {
    document.body.removeAttribute('data-sidebar-mode');
    document.body.removeAttribute('data-sidebar-collapsed');
    document.body.removeAttribute('data-sidebar-open');
  }
});

function ProbeToggle() {
  // Renders buttons that call every action in the sidebar context so we
  // can exercise the public API + side-effects from any mode.
  const { mode, collapsed, mobileOpen, toggleCollapse, toggleMobile } = useSidebar();
  return (
    <div>
      <span data-testid="state">
        {mode}|{collapsed ? 'collapsed' : 'expanded'}|{mobileOpen ? 'open' : 'closed'}
      </span>
      <button onClick={toggleCollapse}>toggleCollapse</button>
      <button onClick={toggleMobile}>toggleMobile</button>
    </div>
  );
}

function renderSidebar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('renders all six primary nav destinations', () => {
    renderSidebar();
    ['Dashboard', 'Forecast', 'Map', 'Experiments', 'Verify', 'Settings'].forEach((label) => {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    });
  });

  it('marks the active route with the is-active class', () => {
    renderSidebar('/map');
    expect(screen.getByRole('link', { name: /map/i }).className).toMatch(/is-active/);
  });

  it('toggles body[data-sidebar-collapsed] when the chevron is clicked', () => {
    renderSidebar();
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('false');
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('persists the collapsed state via the body[data-sidebar-collapsed] attribute', () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('collapses to the icon-rail when the toggle is clicked', () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('animation CSS variables exist + drawer selectors are wired', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    expect(css).toMatch(/--sidebar-w-full:\s*232px/);
    expect(css).toMatch(/--sidebar-w-narrow:\s*64px/);
    expect(css).toMatch(/--sidebar-w-drawer:\s*288px/);
    expect(css).toMatch(/--sidebar-anim:\s*240ms/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('body[data-sidebar-mode="full"][data-sidebar-collapsed="true"]');
    expect(css).toContain('body[data-sidebar-mode="narrow"]');
    expect(css).toContain('body[data-sidebar-mode="drawer"][data-sidebar-open="true"]');
  });
});
