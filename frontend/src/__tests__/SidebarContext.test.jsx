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
  if (typeof document !== 'undefined') {
    document.body.removeAttribute('data-sidebar-mode');
    document.body.removeAttribute('data-sidebar-collapsed');
    document.body.removeAttribute('data-sidebar-open');
  }
});

function Probe() {
  const { mode, collapsed, open, toggleCollapse, toggleMobile, closeMobile } = useSidebar();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="collapsed">{collapsed ? 'collapsed' : 'expanded'}</span>
      <span data-testid="open">{open ? 'open' : 'closed'}</span>
      <button onClick={toggleCollapse}>toggleCollapse</button>
      <button onClick={toggleMobile}>toggleMobile</button>
      <button onClick={closeMobile}>closeMobile</button>
    </div>
  );
}

describe('SidebarContext (v2.1)', () => {
  it('drives body attributes from current state', () => {
    render(<SidebarProvider><Probe /></SidebarProvider>);
    // jsdom default innerWidth is 1024 → desktop mode.
    expect(screen.getByTestId('mode').textContent).toBe('desktop');
    expect(screen.getByTestId('collapsed').textContent).toBe('expanded');
    expect(document.body.getAttribute('data-sidebar-mode')).toBe('desktop');
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('false');
    expect(document.body.getAttribute('data-sidebar-open')).toBe('false');
  });

  it('toggleCollapse flips the side effect on body', () => {
    render(<SidebarProvider><Probe /></SidebarProvider>);
    act(() => screen.getByText('toggleCollapse').click());
    expect(screen.getByTestId('collapsed').textContent).toBe('collapsed');
    expect(document.body.getAttribute('data-sidebar-collapsed')).toBe('true');
  });

  it('toggleMobile flips the open state (mobile-only side effect)', () => {
    // Force mobile mode so the context's "reset open on non-mobile"
    // guard doesn't immediately flip the state back to closed.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({
      matches: q.includes('max-width: 767'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    render(<SidebarProvider><Probe /></SidebarProvider>);
    act(() => screen.getByText('toggleMobile').click());
    expect(screen.getByTestId('open').textContent).toBe('open');
    act(() => screen.getByText('closeMobile').click());
    expect(screen.getByTestId('open').textContent).toBe('closed');
  });

  it('public API exposes exactly: mode, collapsed, open + 3 actions', () => {
    let api;
    function Sink() {
      api = useSidebar();
      return null;
    }
    render(<SidebarProvider><Sink /></SidebarProvider>);
    expect(Object.keys(api).sort()).toEqual(
      ['closeMobile', 'collapsed', 'mode', 'open', 'toggleCollapse', 'toggleMobile'].sort()
    );
  });
});
