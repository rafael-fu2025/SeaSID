import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Message } from '@/components/agent/Message';

describe('Message', () => {
  it('returns null for empty message prop', () => {
    const { container } = render(<Message />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the user message as a right-aligned card', () => {
    render(<Message message={{ role: 'user', content: 'hi' }} />);
    expect(screen.getByTestId('message-user')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('renders the assistant message with tool calls + thinking + body', () => {
    render(
      <Message
        message={{
          role: 'assistant',
          content: 'final answer',
          thinking: 'I should look at tides',
          toolCalls: [
            { name: 'get_forecast', arguments: { site_key: 'dauin_muck' }, result: '{}' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('message-assistant')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-row-get_forecast')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
    expect(screen.getByText('final answer')).toBeInTheDocument();
  });

  it('shows streaming dots when the assistant is in flight with no content', () => {
    render(
      <Message
        message={{ role: 'assistant', content: '', status: 'streaming' }}
      />,
    );
    // The inline placeholder (and its wave.gif) is gone while we wait for
    // the first stream chunk — AgentFab's "Agent thinking…" row owns the
    // single loading indicator now.
    expect(screen.queryByTestId('streaming-dots')).not.toBeInTheDocument();
    expect(screen.queryByTestId('message-assistant-body')).not.toBeInTheDocument();
  });

  it('hides streaming dots once any content has arrived', () => {
    render(
      <Message
        message={{
          role: 'assistant',
          content: 'half a sentence so far',
          status: 'streaming',
        }}
      />,
    );
    expect(screen.queryByTestId('streaming-dots')).toBeNull();
  });

  it('does not render the ThinkingBlock when there is no thinking text', () => {
    render(
      <Message
        message={{ role: 'assistant', content: 'no thoughts here' }}
      />,
    );
    expect(screen.queryByTestId('thinking-block')).toBeNull();
  });

  it('renders the error message in a danger-tinted card', () => {
    render(
      <Message
        message={{ role: 'error', content: 'API down' }}
      />,
    );
    const err = screen.getByTestId('message-error');
    expect(err).toBeInTheDocument();
    expect(err).toHaveAttribute('role', 'alert');
    expect(screen.getByText('API down')).toBeInTheDocument();
  });
});
