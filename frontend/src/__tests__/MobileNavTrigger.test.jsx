import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileNavTrigger from '../components/MobileNavTrigger';
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
    document.body.removeAttribute('data-sidebar-open');
    document.body.removeAttribute('data-sidebar-collapsed');
  }
});

/**
 * MobileNavTrigger is conditionally rendered — it returns `null` when the
 * sidebar isn't in mobile mode. jsdom defaults `window.innerWidth` to
 * 1024, so the context picks `mode="desktop"` by default and the
 * trigger doesn't render anything in test unless we simulate the
 * mobile mode.
 */

function WithMode({ mode = 'full' }) {
  // A consumer that can flip the mode by exposing internal setters via
  // a side-channel: we set body[data-sidebar-mode] from outside via a
  // helper so the provider's effect picks it up. Simpler approach: we
  // just verify the null branch (default mode=full) and use a wrapper
  // to render a forced-mode context by stubbing innerWidth.
  return null;
}

describe('MobileNavTrigger', () => {
  it('returns null when not in mobile mode (jsdom default viewport)', () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <MobileNavTrigger />
        </SidebarProvider>
      </MemoryRouter>
    );
    // No trigger is rendered when the context resolves to mode !== 'mobile'.
    expect(screen.queryByTestId('mobile-nav-trigger')).toBeNull();
  });

  it('renders a button when the context resolves to mobile mode', async () => {
    // Stub innerWidth so pickMode(width) returns 'mobile'.
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 });
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => {
      const matches = q.includes('max-width: 767') ? true : false;
      const stub = {
        matches,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
      return stub;
    });

    render(
      <MemoryRouter>
        <SidebarProvider>
          <MobileNavTrigger />
        </SidebarProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('mobile-nav-trigger')).toBeInTheDocument();
    });

    // Restore
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    vi.restoreAllMocks();
  });
});
