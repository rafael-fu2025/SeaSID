import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '../components/Layout';

function TestChild() {
  return <div data-testid="child">child content</div>;
}

describe('Layout', () => {
  it('renders the sidebar, the child outlet, and footer info', () => {
    render(
      <MemoryRouter initialEntries={['/anything']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/anything" element={<TestChild />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/^SeaSID$/)).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText(/region/i)).toBeInTheDocument();
    expect(screen.getByText(/build/i)).toBeInTheDocument();
  });

  it('highlights the active nav link', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<TestChild />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: /dashboard/i });
    expect(link.className).toMatch(/is-active/);
  });

  it('exposes all six primary nav destinations', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<TestChild />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    ['Dashboard', 'Forecast', 'Map', 'Experiments', 'Verify', 'Settings'].forEach((label) => {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    });
  });
});
