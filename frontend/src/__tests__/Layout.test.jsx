import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';

function TestChild() {
  return <div data-testid="child">child content</div>;
}

const realMatchMedia = window.matchMedia.bind(window);

function stubMatchMedia({ desktop }) {
  // `desktop === true`  → matches desktop queries (default for tests).
  // `desktop === false` → simulates a mobile/tablet viewport.
  window.matchMedia = (query) => {
    const isDesktop = /min-width:\s*1024px/.test(query);
    const matches = desktop ? isDesktop : !isDesktop;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
}

function renderLayout(initial, mode = 'desktop') {
  // Wipe any persisted layout prefs so this test isn't sensitive to
  // leftover localStorage from a prior session.
  try {
    localStorage.removeItem('seasid.cockpit.leftCollapsed');
    localStorage.removeItem('seasid.cockpit.rightCollapsed');
    localStorage.removeItem('seasid.cockpit.v3');
  } catch {}
  stubMatchMedia({ desktop: mode === 'desktop' });
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<TestChild />} />
            <Route path="/anything" element={<TestChild />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe('Layout (cockpit shell) — desktop ≥ 1024 px', () => {
  beforeEach(() => {
    // Restore the production-default matchMedia between suites so
    // each `describe` block has a clean slate.
    stubMatchMedia({ desktop: true });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('renders the brand chip, the child outlet, and the status bar', () => {
    renderLayout('/anything');
    expect(screen.getByTestId('brand-link')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('status-clock')).toBeInTheDocument();
    expect(screen.getByText(/Dumaguete · v3\.0\.0/)).toBeInTheDocument();
  });

  it('renders the expanded nav with icon + label for every page', () => {
    renderLayout('/');
    ['Dashboard', 'Forecast', 'Map', 'Experiments', 'Verify', 'Settings'].forEach((label) => {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}$`, 'i') })).toBeInTheDocument();
    });
  });

  it('exposes both collapse toggles (sidebar + inspector)', () => {
    renderLayout('/');
    expect(screen.getByTestId('nav-collapse')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-collapse')).toBeInTheDocument();
  });

  it('renders the AI Agent FAB and the ⌘K palette opener', () => {
    renderLayout('/');
    expect(screen.getByTestId('agent-fab')).toBeInTheDocument();
    expect(screen.getByTestId('open-palette')).toBeInTheDocument();
  });

  it('exposes a "Reset" link in the expanded sidebar footer', () => {
    renderLayout('/');
    expect(screen.getByLabelText(/reset cockpit layout/i)).toBeInTheDocument();
  });
});

describe('Layout (cockpit shell) — mobile / tablet < 1024 px', () => {
  beforeEach(() => {
    stubMatchMedia({ desktop: false });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('omits the persistent rails and exposes mobile drawer triggers', () => {
    renderLayout('/', 'mobile');
    // In the mobile branch the rails are not rendered at all
    // (`isDesktop` gates DesktopShell vs MobileShell). Only the
    // drawer triggers are mounted.
    expect(screen.queryByTestId('left-rail')).toBeNull();
    expect(screen.queryByTestId('right-rail')).toBeNull();
    // Drawer triggers are mounted
    expect(screen.getByTestId('open-mobile-nav')).toBeInTheDocument();
    expect(screen.getByTestId('open-mobile-inspector')).toBeInTheDocument();
  });

  it('still renders the page outlet, FAB and palette in the mobile shell', () => {
    renderLayout('/', 'mobile');
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('agent-fab')).toBeInTheDocument();
    expect(screen.getByTestId('open-palette')).toBeInTheDocument();
    expect(screen.getByTestId('status-clock')).toBeInTheDocument();
  });
});
