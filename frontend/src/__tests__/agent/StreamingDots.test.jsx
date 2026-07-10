import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreamingDots } from '@/components/agent/StreamingDots';

describe('StreamingDots', () => {
  it('renders three dots with a polite live region', () => {
    render(<StreamingDots />);
    const root = screen.getByTestId('streaming-dots');
    expect(root).toHaveAttribute('role', 'status');
    expect(root).toHaveAttribute('aria-live', 'polite');
    expect(root.children).toHaveLength(3);
  });

  it('uses a custom label when provided', () => {
    render(<StreamingDots label="Crunching forecast" />);
    expect(
      screen.getByLabelText('Crunching forecast'),
    ).toBeInTheDocument();
  });

  it('applies animate-pulse + staggered delays so dots pulse in a wave', () => {
    render(<StreamingDots />);
    const dots = screen.getByTestId('streaming-dots').children;
    expect(dots[0]).toHaveClass('animate-pulse');
    expect(dots[0]).toHaveStyle({ animationDelay: '0ms' });
    expect(dots[1]).toHaveStyle({ animationDelay: '180ms' });
    expect(dots[2]).toHaveStyle({ animationDelay: '360ms' });
  });
});
