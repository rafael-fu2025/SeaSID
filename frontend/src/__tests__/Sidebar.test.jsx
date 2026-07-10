import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import CollapseFab from '../components/CollapseFab';
import Layout from '../components/Layout';
import { SidebarProvider, useSidebar } from '../theme/SidebarContext';
import { ThemeProvider } from '../theme/ThemeContext';
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

function renderShell(initialPath = '/') {
  // Render the full Layout (Sidebar + CollapseFab + main + AgentFab)
  // so the FAB contract is exercised in the same DOM tree the user sees.
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider>
        <SidebarProvider>
          <Layout />
        </SidebarProvider>
      </ThemeProvider>
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
    renderShell();
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('false');
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('collapse pill is a sibling of .sidebar, not a child', () => {
    // The FAB must live OUTSIDE the .sidebar <aside>. A child placement
    // would inherit the rail's overflow / scroll / padding, and the
    // user's request is explicit: it must function like a real FAB
    // button — neither part of the sidebar nor the main column.
    const { container } = renderShell();
    const sidebar = container.querySelector('aside.sidebar');
    expect(sidebar, '.sidebar should render an <aside>').not.toBeNull();
    const pill = screen.getByTestId('sidebar-collapse');
    expect(pill.classList.contains('sidebar__collapse')).toBe(false);
    expect(pill.classList.contains('collapse-fab')).toBe(true);
    // The pill is NOT a descendant of the <aside>.
    expect(sidebar.contains(pill)).toBe(false);
    // The pill IS a descendant of the .app-layout shell.
    const shell = container.querySelector('.app-layout');
    expect(shell.contains(pill)).toBe(true);
    // Sibling of the aside within the shell.
    expect(shell.querySelector('aside.sidebar').nextElementSibling).toBe(pill);
  });

  it('persists the collapsed state via the body[data-sidebar-collapsed] attribute', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('collapses to the icon-rail when the toggle is clicked', () => {
    renderShell();
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

  it('collapse FAB sits on the seam (not next to the brand, not inside the rail)', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

    // The .sidebar__collapse rule from older versions of this file
    // would render the pill as a child of .sidebar — which is exactly
    // the lazy placement the user complained about. Guard against it.
    expect(css).not.toMatch(/\.sidebar__collapse\s*\{/);

    // The replacement FAB rule must:
    //   - hang above the sidebar's top edge (negative top offset)
    //   - position itself relative to the current sidebar width via
    //     the --sidebar-current variable (so it animates with the rail)
    //   - sit at a high z-index (above the FAB agent button at 50 and
    //     the sidebar at 20)
    const block = css.match(/\.collapse-fab\s*\{([\s\S]*?)\}/);
    expect(block, '.collapse-fab rule not found in CSS').not.toBeNull();
    const body = block[1];
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/top:\s*-\d+px/);
    expect(body).toMatch(/var\(--sidebar-current\)/);
    expect(body).toMatch(/z-index:\s*[6-9]\d/); // 60–99
  });
});
