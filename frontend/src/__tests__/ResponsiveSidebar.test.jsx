import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '../theme/SidebarContext';

/**
 * Responsive sidebar behaviour — assert the four breakpoints produce
 * the right CSS body attributes via the context.
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

describe('Sidebar responsive behaviour', () => {
  it('xs (<640) → drawer mode', async () => {
    setViewport(375, {
      '(max-width: 639px)': true,
    });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('drawer');
    });
  });

  it('sm (640-767) → drawer mode', async () => {
    setViewport(700, {
      '(max-width: 639px)': false,
    });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('drawer');
    });
  });

  it('md (768-1023) → narrow mode (persistent 64px rail)', async () => {
    setViewport(900, {
      '(min-width: 768px)': true,
      '(min-width: 1024px)': false,
    });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('narrow');
    });
  });

  it('lg (≥1024) → full mode (collapse-able)', async () => {
    setViewport(1280, {
      '(min-width: 768px)': true,
      '(min-width: 1024px)': true,
    });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('full');
    });
  });

  it('xl (1600) → still full mode', async () => {
    setViewport(1600, {
      '(min-width: 768px)': true,
      '(min-width: 1024px)': true,
    });
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.getAttribute('data-sidebar-mode')).toBe('full');
    });
  });
});
