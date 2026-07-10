import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Agent from '../pages/Agent';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getSites: vi.fn(),
    chat: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.getSites.mockResolvedValue([
    { key: 'dauin_muck', name: 'Dauin Muck Bays', type: 'muck' },
  ]);
});

describe('Agent page (legacy route)', () => {
  it('redirects to / since the chat moved into the AgentFab', async () => {
    render(
      <MemoryRouter initialEntries={['/agent']}>
        <Routes>
          <Route path="/agent" element={<Agent />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>
    );

    // The redirect fires inside a useEffect, so we wait for it.
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument();
    });
  });
});

