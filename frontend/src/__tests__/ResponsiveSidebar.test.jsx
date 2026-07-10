import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '../theme/SidebarContext';

/**
 * Responsive sidebar behaviour — assert the two-mode design:
 *
 *   xs / sm (< 768)  → mode="mobile"  (drawer overlay)
 *   md / lg / xl (≥ 768)  → mode="desktop" (collapsible rail)
 *
 * We stub `window.innerWidth` and `window.matchMedia` so the context's
 * initial-mode-detection effect resolves to a specific breakpoint
 * without having to actually resize the viewport.
 */

function setViewport(width, mqMap = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  vi.spyOn(window, 'matchMedia').mockImplementation((q) => {
    const matches = mqMap[q] ?? false;
    return {
      matches,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  });
}

beforeEach(() => {
  if (typeof document !== 'undefined') {
    document.body.removeAttribute('data-sidebar-mode');
    document.body.removeAttribute('data-sidebar-collapsed');
    document.body.removeAttribute('data-sidebar-open');
  }
  vi.restoreAllMocks();
});

function Tree() {
  return (
    <SidebarProvider>
      <div data-testid="probe">probe</div>
    </SidebarProvider>
  );
}

describe('Sidebar responsive behaviour (v2.1)', () => {
  it('xs (375) → mobile mode', async () => {
    setViewport(375, { '(max-width: 767px)': true });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('mobile');
    });
  });

  it('sm (700) → mobile mode', async () => {
    setViewport(700, { '(max-width: 767px)': true });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('mobile');
    });
  });

  it('md (900) → desktop mode', async () => {
    setViewport(900, { '(min-width: 768px)': true });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('desktop');
    });
  });

  it('lg (1280) → desktop mode', async () => {
    setViewport(1280, { '(min-width: 768px)': true });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('desktop');
    });
  });

  it('xl (1600) → still desktop mode', async () => {
    setViewport(1600, { '(min-width: 768px)': true });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('desktop');
    });
  });
});
