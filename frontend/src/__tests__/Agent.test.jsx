import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Agent from '@/pages/Agent';

describe('Agent page (legacy route)', () => {
  it('redirects to / since the chat moved into the AgentFab', async () => {
    render(
      <MemoryRouter initialEntries={['/agent']}>
        <Routes>
          <Route path="/agent" element={<Agent />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument();
    });
  });
});
