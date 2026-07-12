import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

  it('opens the Sheet on FAB click and shows the empty state', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(screen.getByText('SeaSID Agent')).toBeInTheDocument();
    expect(screen.getByText(/no conversation yet/i)).toBeInTheDocument();
  });

  it('renders suggested prompts as clickable <button>s (roadmap #10)', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // Three clickable prompt buttons, accessible by data-testid.
    const prompts = ['agent-prompt-0', 'agent-prompt-1', 'agent-prompt-2'];
    for (const id of prompts) {
      const btn = screen.getByTestId(id);
      expect(btn).toBeInTheDocument();
      expect(btn.tagName.toLowerCase()).toBe('button');
    }
  });

  it('clicking a suggested prompt sends it (roadmap #10)', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    fireEvent.click(screen.getByTestId('agent-prompt-0'));

    await waitFor(() => expect(streamChat).toHaveBeenCalled());
    expect(streamChat.mock.calls[0][0].message).toMatch(/dive at dauin_muck/i);
    expect(streamChat.mock.calls[0][0].siteKey).toBe('dauin_muck');
  });

  it('renders a composer with input + send button', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(screen.getByTestId('agent-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-send')).toBeInTheDocument();
  });

  it('composer hint matches actual behaviour (Enter to send, no Shift+Enter claim)', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // The misleading "Shift+Enter for newline" line must be gone.
    expect(screen.queryByText(/Shift\+Enter/i)).not.toBeInTheDocument();
    // The correct, honest hint is present.
    expect(screen.getByText(/Enter to send/i)).toBeInTheDocument();
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

  it('shows a site context selector in the header (roadmap #10)', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const ctx = screen.getByTestId('agent-site-context');
    expect(ctx).toBeInTheDocument();
    // The SiteSelector exposes a combobox trigger once sites have loaded.
    expect(await screen.findByTestId('agent-site-selector')).toBeInTheDocument();
  });

  it('reset confirms via window.confirm when transcript is non-empty (roadmap #10)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = screen.getByTestId('agent-input');
    fireEvent.change(input, { target: { value: 'Quick question' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await screen.findByText(/conditions look safe at dauin today/i);

    const reset = screen.getByTestId('agent-reset');
    fireEvent.click(reset);

    // User declined → messages should still be present.
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/no conversation yet/i)).not.toBeInTheDocument();

    // User accepts → messages should clear.
    confirmSpy.mockReturnValue(true);
    fireEvent.click(reset);
    expect(await screen.findByText(/no conversation yet/i)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('reset does not prompt when transcript is empty', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // Reset is disabled in the empty state, so we use a click on a
    // re-enabled button instead — but at this point the button is
    // disabled (no messages). So we just confirm that confirm() is
    // never called when the user cannot click reset.
    const reset = screen.getByTestId('agent-reset');
    expect(reset).toBeDisabled();
    confirmSpy.mockRestore();
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

    expect(await screen.findByTestId('tool-call-row-get_forecast')).toBeInTheDocument();
    expect(await screen.findByTestId('thinking-block')).toBeInTheDocument();
    expect(await screen.findByText(/it looks good today/i)).toBeInTheDocument();
  });
});
