import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';

function TestChild() {
  return <div data-testid="child">child content</div>;
}

function renderLayout(initial) {
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

describe('Layout (cockpit shell)', () => {
  it('renders the brand, child outlet, and status bar', () => {
    renderLayout('/anything');
    // Brand chip (lucide icon w/ aria-label)
    expect(screen.getByLabelText('SeaSID')).toBeInTheDocument();
    // Outlet
    expect(screen.getByTestId('child')).toBeInTheDocument();
    // Status bar version line
    expect(screen.getByText(/Dumaguete/)).toBeInTheDocument();
    expect(screen.getByText(/v3\.0\.0/)).toBeInTheDocument();
  });

  it('marks the active nav link on /', () => {
    renderLayout('/');
    const link = screen.getByRole('link', { name: /dashboard/i });
    // The active state is surfaced via an absolute left-accent bar inside
    // the link (see SidebarNav.jsx).
    expect(link.querySelector('span.opacity-100')).not.toBeNull();
  });

  it('exposes all six primary nav destinations', () => {
    renderLayout('/');
    ['Dashboard', 'Forecast', 'Map', 'Experiments', 'Verify', 'Settings'].forEach((label) => {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}$`, 'i') })).toBeInTheDocument();
    });
  });

  it('renders the AI Agent FAB and palette opener', () => {
    renderLayout('/');
    expect(screen.getByTestId('agent-fab')).toBeInTheDocument();
    expect(screen.getByTestId('open-palette')).toBeInTheDocument();
  });
});
