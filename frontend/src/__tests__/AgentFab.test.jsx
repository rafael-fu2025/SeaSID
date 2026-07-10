import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentFab from '../components/AgentFab';
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
    { key: 'apo_reef', name: 'Apo Island Reef', type: 'reef' },
  ]);
  api.chat.mockResolvedValue({
    response: 'Conditions look safe at Dauin today.',
    conversation_id: 'conv-1',
    tool_calls: [{ name: 'get_forecast', arguments: { site_key: 'dauin_muck' }, result: '{}' }],
  });
});

describe('AgentFab', () => {
  it('renders a single floating button anchored bottom-right', () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    const fab = screen.getByTestId('agent-fab');
    expect(fab).toBeInTheDocument();
    expect(fab.tagName.toLowerCase()).toBe('button');
    expect(fab).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not show the popover until the FAB is clicked', () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    expect(screen.queryByTestId('agent-popover')).toBeNull();
  });

  it('opens the popover when the FAB is clicked', async () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    const fab = screen.getByTestId('agent-fab');
    fireEvent.click(fab);
    await waitFor(() => {
      expect(screen.getByTestId('agent-popover')).toBeInTheDocument();
    });
    expect(fab).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows an empty-state hero with three prompt suggestions', async () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(await screen.findByText('SeaSID Agent')).toBeInTheDocument();
    expect(screen.getByText(/should i dive at dauin/i)).toBeInTheDocument();
    expect(screen.getByText(/compare current conditions/i)).toBeInTheDocument();
    expect(screen.getByText(/one-page safety briefing/i)).toBeInTheDocument();
  });

  it('sends a prompt via the api and renders the reply', async () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('agent-fab'));
    const prompt = await screen.findByText(/should i dive at dauin/i);
    fireEvent.click(prompt);

    await waitFor(() => {
      expect(api.chat).toHaveBeenCalledTimes(1);
    });

    const args = api.chat.mock.calls[0];
    expect(args[0]).toMatch(/dauin/i);
    expect(args[2]).toBe('dauin_muck');

    expect(await screen.findByText(/Conditions look safe at Dauin today/)).toBeInTheDocument();
  });

  it('closes when the close icon button is pressed', async () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('agent-fab'));
    const popover = await screen.findByTestId('agent-popover');
    expect(popover).toBeInTheDocument();

    // Scope the close lookup to inside the popover — the FAB itself has
    // its own aria-label "Close agent chat" once the popover is open.
    const closeBtn = popover.querySelector('button[aria-label="Close"]');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('agent-popover')).toBeNull();
    });
    expect(screen.getByTestId('agent-fab')).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a composer input + send button inside the popover', async () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(await screen.findByTestId('fab-chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('fab-chat-send')).toBeInTheDocument();
  });

  it('submits the composer textarea on Enter (without Shift) and calls api.chat', async () => {
    render(<MemoryRouter><AgentFab /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = await screen.findByTestId('fab-chat-input');
    fireEvent.change(input, { target: { value: 'How rough is the water today?' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(api.chat).toHaveBeenCalledWith(
        'How rough is the water today?',
        null,
        'dauin_muck',
      );
    });
  });
});
