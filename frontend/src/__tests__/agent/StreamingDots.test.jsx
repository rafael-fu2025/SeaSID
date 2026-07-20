import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreamingDots } from '@/components/agent/StreamingDots';

describe('StreamingDots', () => {
  it('renders a polite live region announcing the agent thinking state', () => {
    render(<StreamingDots />);
    const root = screen.getByTestId('streaming-dots');
    expect(root).toHaveAttribute('role', 'status');
    expect(root).toHaveAttribute('aria-live', 'polite');
    expect(root).toHaveAttribute('aria-label', 'Agent thinking');
  });

  it('uses a custom label when provided', () => {
    render(<StreamingDots label="Crunching forecast" />);
    expect(
      screen.getByLabelText('Crunching forecast'),
    ).toBeInTheDocument();
  });

  it('renders the wave.gif image as its single visual child', () => {
    render(<StreamingDots />);
    const root = screen.getByTestId('streaming-dots');
    expect(root.children).toHaveLength(1);
    const gif = screen.getByTestId('streaming-dots-gif');
    expect(gif.tagName).toBe('IMG');
    // The gif URL is bundled by Vite into an asset path, so just assert
    // a non-empty src and the aria-hidden flag that lets screen readers
    // rely on the parent aria-label only.
    expect(gif.getAttribute('src')).toMatch(/\.gif$/);
    expect(gif).toHaveAttribute('aria-hidden', 'true');
    expect(gif).toHaveAttribute('alt', '');
    expect(gif).toHaveClass('h-5');
  });
});
