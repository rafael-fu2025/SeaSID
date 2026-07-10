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

function Probe() {
  // Exposes the raw context so we can verify transitions.
  const { collapsed, open } = useSidebar();
  return (
    <div>
      <span data-testid="collapsed">{collapsed ? 'collapsed' : 'expanded'}</span>
      <span data-testid="open">{open ? 'open' : 'closed'}</span>
    </div>
  );
}

function renderSidebar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SidebarProvider>
        <Sidebar />
        <Probe />
      </SidebarProvider>
    </MemoryRouter>
  );
}

describe('Sidebar (v2.1)', () => {
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

  it('renders the collapse button INSIDE the sidebar footer', () => {
    // The collapse control must be a descendant of <aside class="sidebar">
    // — not a sibling. This is the regression the user complained about.
    const { container } = renderSidebar();
    const sidebar = container.querySelector('aside.sidebar');
    expect(sidebar, 'sidebar <aside> must render').not.toBeNull();
    const collapse = screen.getByTestId('sidebar-collapse');
    expect(sidebar.contains(collapse)).toBe(true);
    // Footer is the LAST child of the sidebar (renders after brand + nav).
    expect(sidebar.lastElementChild.classList.contains('sidebar__footer')).toBe(true);
    expect(collapse.closest('.sidebar__footer')).not.toBeNull();
  });

  it('clicking the footer collapse button flips body[data-sidebar-collapsed]', () => {
    renderSidebar();
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('false');
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('false');
  });

  it('CSS contract: collapse button lives in the sidebar footer (NOT a FAB)', () => {
    // The previous design had a .collapse-fab class positioned with
    // position:absolute, left: calc(var(--sidebar-current) - 14px). The
    // current design moves the control INTO .sidebar__footer so it
    // scrolls with the rail naturally and never fights .sidebar's
    // overflow rules. Guard against regressions to either design.
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    expect(css).not.toMatch(/\.collapse-fab\s*\{/);
    // The collapse rule must live under .sidebar__collapse, NOT
    // position:absolute against .app-layout.
    expect(css).toMatch(/\.sidebar__collapse\s*\{/);
    const block = css.match(/\.sidebar__collapse\s*\{([\s\S]*?)\}/);
    expect(block).not.toBeNull();
    // It's a flex row, not an absolutely-positioned FAB.
    expect(block[1]).toMatch(/display:\s*inline-flex/);
  });

  it('two-mode CSS: desktop ≥ 768 px, mobile < 768 px', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    expect(css).toMatch(/\.sidebar\[data-mode="desktop"\]/);
    expect(css).toMatch(/\.sidebar\[data-mode="mobile"\]/);
    expect(css).toMatch(/@media \(max-width: 767px\)/);
    // Drawer transitions on transform (GPU-friendly).
    expect(css).toMatch(/transform:\s*translateX\(0\)/);
    expect(css).toMatch(/transform:\s*translateX\(-100%\)/);
  });
});
