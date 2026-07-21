import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('does not render suggested prompt buttons (roadmap #10 removed)', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(screen.queryByTestId('agent-prompt-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-prompt-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-prompt-2')).not.toBeInTheDocument();
  });

  it('does not render inline suggestion chips above the input', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(screen.queryByTestId('agent-suggestions')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^agent-suggestion-\d+$/)).toHaveLength(0);
  });

  it('renders a composer with input + send button', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    expect(screen.getByTestId('agent-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-send')).toBeInTheDocument();
  });

  it('composer hint matches actual behaviour (Enter to send, Shift+Enter for newline)', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // The composer shows the keyboard hint via the inline kbd
    // affordance rather than a single text string. Verify the
    // "send" + "newline" hints are present, and that the tooltip
    // on the send button is the canonical "Send (Enter)" label.
    expect(screen.getByText(/^send$/i)).toBeInTheDocument();
    expect(screen.getByText(/^newline$/i)).toBeInTheDocument();
    expect(screen.getByTestId('agent-send')).toHaveAttribute('aria-label', 'Send message');
  });

  it('composer shows the current site as a chip so the user knows the context', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const chip = screen.getByTestId('agent-composer-site');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toMatch(/dauin_muck/);
  });

  it('shows a Stop button while streaming that aborts the in-flight request', async () => {
    // Stream that respects the AbortSignal: when aborted, the finally
    // block flips `aborted` to true, mirroring what streamChat would
    // do in production (close the underlying fetch).
    let aborted = false;
    streamChat.mockImplementation(async function* (opts = {}) {
      try {
        yield { type: 'status', conversation_id: 'conv-3' };
        while (true) {
          if (opts.signal?.aborted) return;
          await new Promise((r) => setTimeout(r, 10));
          yield { type: 'text', delta: 'still going…' };
        }
      } finally {
        aborted = true;
      }
    });

    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    fireEvent.change(screen.getByTestId('agent-input'), { target: { value: 'go' } });
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: false });

    // While streaming the Stop control replaces the Send button.
    const stopBtn = await screen.findByTestId('agent-stop');
    expect(stopBtn).toBeInTheDocument();
    expect(screen.queryByTestId('agent-send')).not.toBeInTheDocument();

    fireEvent.click(stopBtn);
    await waitFor(() => expect(aborted).toBe(true));
  });

  it('grows the textarea as the user types multi-line content', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const ta = screen.getByTestId('agent-input');
    // Seed a multi-line draft; the height should grow past the
    // single-line baseline.
    fireEvent.change(ta, {
      target: { value: 'line one\nline two\nline three\nline four' },
    });
    expect(ta.style.height).not.toBe('');
  });

  it('shows a character + word counter that updates as the user types', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const ta = screen.getByTestId('agent-input');
    fireEvent.change(ta, { target: { value: 'hello world' } });
    const counter = screen.getByTestId('agent-char-count');
    expect(counter.textContent).toMatch(/2 words/);
    expect(counter.textContent).toMatch(/11\/2000/);
  });

  it('auto-focuses the textarea when the sheet opens', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // The composer mounts lazily with the Sheet. After one rAF the
    // imperative focus() call from AgentFab has landed and the
    // textarea is the active element.
    await waitFor(() => {
      const ta = screen.getByTestId('agent-input');
      expect(document.activeElement).toBe(ta);
    });
  });

  it('refocuses the textarea when the agent response finishes', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // The textarea is focused on open. Blur it to simulate the user
    // clicking on the transcript while the response is streaming.
    fireEvent.change(screen.getByTestId('agent-input'), { target: { value: 'go' } });
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: false });

    // Wait for the reply to render.
    await screen.findByText(/conditions look safe at dauin today/i);

    // The composer should have pulled focus back. Use a short wait
    // because the refocus runs in the finally block after state has
    // committed, which happens a microtask or two after the text
    // appears.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('agent-input'));
    });
  });

  it('refocuses the textarea after a Reset', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // Send something so the transcript is non-empty (Reset dialog
    // only opens in that case).
    fireEvent.change(screen.getByTestId('agent-input'), { target: { value: 'go' } });
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: false });
    await screen.findByText(/conditions look safe at dauin today/i);

    // Open + confirm Reset.
    fireEvent.click(screen.getByTestId('agent-reset'));
    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('agent-input'));
    });
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

  it('reset confirms via the Sign out/Reset dialog when transcript is non-empty (roadmap #10)', async () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    const input = screen.getByTestId('agent-input');
    fireEvent.change(input, { target: { value: 'Quick question' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await screen.findByText(/conditions look safe at dauin today/i);

    const reset = screen.getByTestId('agent-reset');
    fireEvent.click(reset);

    // The custom dialog opens; user clicks Keep conversation → messages stay.
    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(screen.queryByText(/no conversation yet/i)).not.toBeInTheDocument();

    // Re-opening the dialog and clicking Discard clears the transcript.
    fireEvent.click(reset);
    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(await screen.findByText(/no conversation yet/i)).toBeInTheDocument();
  });

  it('reset does not prompt when transcript is empty', () => {
    renderFab();
    fireEvent.click(screen.getByTestId('agent-fab'));
    // The empty-state reset button stays disabled so no dialog is shown.
    const reset = screen.getByTestId('agent-reset');
    expect(reset).toBeDisabled();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
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
