import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThinkingBlock } from '@/components/agent/ThinkingBlock';

describe('ThinkingBlock', () => {
  it('renders nothing when the text is empty or whitespace', () => {
    const { container: c1 } = render(<ThinkingBlock>{''}</ThinkingBlock>);
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(<ThinkingBlock>{'   \n  '}</ThinkingBlock>);
    expect(c2.firstChild).toBeNull();
  });

  it('renders a "Thinking" toggle with the body collapsed by default', () => {
    render(<ThinkingBlock>{'reasoning text here'}</ThinkingBlock>);
    const toggle = screen.getByTestId('thinking-toggle');
    expect(toggle).toBeInTheDocument();
    // Body exists in DOM but hidden via class when not expanded
    const body = screen.getByTestId('thinking-body');
    expect(body).toHaveClass('hidden');
  });

  it('expands the body when the toggle is clicked', () => {
    render(<ThinkingBlock>{'more reasoning'}</ThinkingBlock>);
    const toggle = screen.getByTestId('thinking-toggle');
    fireEvent.click(toggle);
    const body = screen.getByTestId('thinking-body');
    expect(body).not.toHaveClass('hidden');
    expect(body.textContent).toContain('more reasoning');
  });

  it('respects defaultOpen', () => {
    render(<ThinkingBlock defaultOpen>{'open by default'}</ThinkingBlock>);
    const body = screen.getByTestId('thinking-body');
    expect(body).not.toHaveClass('hidden');
  });

  it('reports a character count in the trigger', () => {
    const text = 'one two three four five';
    render(<ThinkingBlock>{text}</ThinkingBlock>);
    expect(screen.getByText(`${text.length} chars`)).toBeInTheDocument();
  });
});
