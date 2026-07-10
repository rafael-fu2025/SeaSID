import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App routing', () => {
  it('renders sidebar nav, Dashboard heading, FAB, and toggle button on /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText(/^SeaSID$/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByTestId('agent-fab')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-collapse')).toBeInTheDocument();
  });
});
