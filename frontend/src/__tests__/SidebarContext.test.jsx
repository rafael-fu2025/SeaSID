import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SidebarProvider, useSidebar } from '../theme/SidebarContext';

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
  // Reset body attributes the provider writes.
  if (typeof document !== 'undefined') {
    document.body.removeAttribute('data-sidebar-mode');
    document.body.removeAttribute('data-sidebar-collapsed');
    document.body.removeAttribute('data-sidebar-open');
    document.body.style.overflow = '';
  }
});

function Probe() {
  const { mode, collapsed, mobileOpen, toggleCollapse, closeMobile, toggleMobile, setCollapsed } = useSidebar();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="collapsed">{collapsed ? 'collapsed' : 'expanded'}</span>
      <span data-testid="mobileOpen">{mobileOpen ? 'open' : 'closed'}</span>
      <button onClick={toggleCollapse}>toggleCollapse</button>
      <button onClick={toggleMobile}>toggleMobile</button>
      <button onClick={closeMobile}>closeMobile</button>
      <button onClick={() => setCollapsed(true)}>setCollapsedTrue</button>
      <button onClick={() => setCollapsed(false)}>setCollapsedFalse</button>
    </div>
  );
}

describe('SidebarContext', () => {
  it('drives body attributes from current state', () => {
    render(<SidebarProvider><Probe /></SidebarProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('full');
    expect(screen.getByTestId('collapsed').textContent).toBe('expanded');
    expect(document.body.getAttribute('data-sidebar-mode')).toBe('full');
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('false');
  });

  it('toggleCollapse flips the side effect on body', () => {
    render(<SidebarProvider><Probe /></SidebarProvider>);
    act(() => screen.getByText('toggleCollapse').click());
    expect(screen.getByTestId('collapsed').textContent).toBe('collapsed');
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('setCollapsed(true) toggles the body attribute on', () => {
    render(<SidebarProvider><Probe /></SidebarProvider>);
    act(() => screen.getByText('setCollapsedTrue').click());
    expect(screen.getByTestId('collapsed').textContent).toBe('collapsed');
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('setCollapsed(false) restores the side effect', () => {
    render(<SidebarProvider><Probe /></SidebarProvider>);
    act(() => screen.getByText('setCollapsedTrue').click());
    act(() => screen.getByText('setCollapsedFalse').click());
    expect(screen.getByTestId('collapsed').textContent).toBe('expanded');
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('false');
  });

  it('mode (drawer) toggles mobileOpen without touching collapsed', () => {
    render(<SidebarProvider><Probe /></SidebarProvider>);
    act(() => screen.getByText('toggleMobile').click());
    expect(screen.getByTestId('mobileOpen').textContent).toBe('open');
    expect(document.body.getAttribute('data-sidebar-open')).toBe('true');
    act(() => screen.getByText('closeMobile').click());
    expect(screen.getByTestId('mobileOpen').textContent).toBe('closed');
    expect(document.body.getAttribute('data-sidebar-open')).toBe('false');
  });
});
