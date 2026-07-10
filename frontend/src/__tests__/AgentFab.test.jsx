import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentFab } from '@/components/AgentFab';
import { api } from '@/api';

vi.mock('@/api', () => ({
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

function renderFab() {
  return render(
    <TooltipProvider>
      <AgentFab />
    </TooltipProvider>,
  );
}

describe('AgentFab', () => {
  it('renders a single floating button anchored bottom-right', () => {
    renderFab();
    const fab = screen.getByTestId('agent-fab');
    expect(fab).toBeInTheDocument();
    expect(fab.tagName.toLowerCase()).toBe('button');
  });

  it('opens the Sheet on FAB click and shows the empty state', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(await screen.findByText('SeaSID Agent')).toBeInTheDocument();
    expect(screen.getByText(/no conversation yet/i)).toBeInTheDocument();
    // Three suggestion chips match the legacy suggestion set.
    expect(screen.getByText(/should i dive at dauin/i)).toBeInTheDocument();
    expect(screen.getByText(/compare current conditions/i)).toBeInTheDocument();
    expect(screen.getByText(/generate a one-page safety briefing/i)).toBeInTheDocument();
  });

  it('renders a composer with input + send button', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(await screen.findByTestId('agent-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-send')).toBeInTheDocument();
  });

  it('submits composer text on Enter and calls api.chat', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = await screen.findByTestId('agent-input');
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

  it('renders the reply from /agent/chat after a send', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = await screen.findByTestId('agent-input');
    fireEvent.change(input, { target: { value: 'Brief the conditions' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(await screen.findByText(/conditions look safe at dauin today/i)).toBeInTheDocument();
  });

  it('responds to the global "seasid:open-agent" event', async () => {
    renderFab();
    window.dispatchEvent(new CustomEvent('seasid:open-agent'));
    expect(await screen.findByText('SeaSID Agent')).toBeInTheDocument();
  });

  it('reset clears the conversation history', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = await screen.findByTestId('agent-input');
    fireEvent.change(input, { target: { value: 'Quick question' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await screen.findByText(/conditions look safe at dauin today/i);

    const reset = screen.getByTestId('agent-reset');
    fireEvent.click(reset);
    // Back to empty-state after reset.
    expect(await screen.findByText(/no conversation yet/i)).toBeInTheDocument();
  });
});
