import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentFab } from '@/components/AgentFab';
import { api, streamChat } from '@/api';

vi.mock('@/api', () => ({
  api: {
    getSites: vi.fn(),
    chat: vi.fn(),
  },
  streamChat: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.getSites.mockResolvedValue([
    { key: 'dauin_muck', name: 'Dauin Muck Bays', type: 'muck' },
    { key: 'apo_reef', name: 'Apo Island Reef', type: 'reef' },
  ]);
  // Default: text-only stream that mirrors the legacy AgentFab
  // response shape so all pre-existing assertions keep working.
  streamChat.mockImplementation(async function* () {
    yield { type: 'status', conversation_id: 'conv-1' };
    yield { type: 'text', delta: 'Conditions look safe at Dauin today.' };
    yield { type: 'done', finishReason: 'stop' };
  });
});

function renderFab() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <AgentFab />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('AgentFab', () => {
  it('renders a single floating button anchored bottom-right', () => {
    renderFab();
    const fab = screen.getByTestId('agent-fab');
    expect(fab).toBeInTheDocument();
    expect(fab.tagName.toLowerCase()).toBe('button');
  });

  it('opens the Sheet on FAB click and shows the empty state', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(screen.getByText('SeaSID Agent')).toBeInTheDocument();
    expect(screen.getByText(/no conversation yet/i)).toBeInTheDocument();
    expect(screen.getByText(/should i dive at dauin/i)).toBeInTheDocument();
    expect(screen.getByText(/compare current conditions/i)).toBeInTheDocument();
    expect(screen.getByText(/generate a one-page safety briefing/i)).toBeInTheDocument();
  });

  it('renders a composer with input + send button', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(screen.getByTestId('agent-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-send')).toBeInTheDocument();
  });

  it('submits composer text on Enter and consumes the SSE stream', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = screen.getByTestId('agent-input');
    fireEvent.change(input, { target: { value: 'How rough is the water today?' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(streamChat).toHaveBeenCalled();
    });
    expect(streamChat.mock.calls[0][0]).toMatchObject({
      message: 'How rough is the water today?',
      siteKey: 'dauin_muck',
    });

    expect(await screen.findByText(/conditions look safe at dauin today/i)).toBeInTheDocument();
  });

  it('renders the reply from the stream after a send', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = screen.getByTestId('agent-input');
    fireEvent.change(input, { target: { value: 'Brief the conditions' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    // Wait for the generator to be consumed first so the React state
    // updates have a chance to flush before we look for the text.
    await waitFor(() => {
      expect(streamChat).toHaveBeenCalled();
    });
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
    const input = screen.getByTestId('agent-input');
    fireEvent.change(input, { target: { value: 'Quick question' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await screen.findByText(/conditions look safe at dauin today/i);

    const reset = screen.getByTestId('agent-reset');
    fireEvent.click(reset);
    // Back to empty-state after reset.
    expect(await screen.findByText(/no conversation yet/i)).toBeInTheDocument();
  });

  it('streams tool calls and thinking into the assistant message', async () => {
    // A stream that mimics a real tool-using agent: emits tool_call,
    // then text deltas, then a tool_result, then a done.
    streamChat.mockImplementation(async function* () {
      yield { type: 'status', conversation_id: 'conv-2' };
      yield {
        type: 'tool_call',
        id: 'tc-1',
        name: 'get_forecast',
        arguments: { site_key: 'dauin_muck' },
      };
      yield { type: 'text', delta: 'Looking at the forecast…' };
      yield {
        type: 'tool_result',
        id: 'tc-1',
        name: 'get_forecast',
        output: '{"ok":true}',
        durationMs: 142,
      };
      yield { type: 'text', delta: '<think>tide is fine</think>' };
      yield { type: 'text', delta: 'It looks good today.' };
      yield { type: 'done', finishReason: 'stop' };
    });

    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    fireEvent.change(screen.getByTestId('agent-input'), {
      target: { value: 'go' },
    });
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: false });

    // Tool call row appears
    expect(await screen.findByTestId('tool-call-row-get_forecast')).toBeInTheDocument();
    // Thinking block appears (only the think-tagged text, not the visible)
    expect(await screen.findByTestId('thinking-block')).toBeInTheDocument();
    // Visible text appears
    expect(await screen.findByText(/it looks good today/i)).toBeInTheDocument();
  });
});
