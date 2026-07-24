import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PBadChart from '@/components/PBadChart';

const HOURS = Array.from({ length: 6 }, (_, i) => ({
  ts: `2026-07-09T${String(i).padStart(2, '0')}:00:00+00:00`,
  p_bad: 0.1 + i * 0.1,
  risk: 'MODERATE',
}));

// jsdom does not implement getBoundingClientRect; ResponsiveContainer relies
// on it. Patch a sensible default before any chart mounts.
beforeAll(() => {
  if (typeof window === 'undefined') return;
  const noop = () => ({
    width: 600,
    height: 224,
    top: 0,
    left: 0,
    right: 600,
    bottom: 224,
  });
  window.HTMLElement.prototype.getBoundingClientRect = noop;
  window.SVGElement.prototype.getBoundingClientRect = noop;
});
afterEach(cleanup);

// jsdom has no ResizeObserver. Install a synchronous mock that fires the
// callback immediately so Recharts ResponsiveContainer mounts children in
// the same render pass instead of on a microtask we never flush.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class MockResizeObserver {
    constructor(cb) { this._cb = typeof cb === 'function' ? cb : null; }
    observe(el) {
      if (el && this._cb) {
        this._cb([{ target: el, contentRect: { width: 600, height: 224 } }]);
      }
    }
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = MockResizeObserver;
}

describe('PBadChart (Recharts LineChart)', () => {
  it('renders the chart frame inside the card', () => {
    const { container } = render(<PBadChart hours={HOURS} />);
    const card = screen.getByTestId('pbad-chart');
    expect(card).toBeTruthy();
    const frame = container.querySelector('[data-testid="pbad-chart-frame"]');
    expect(frame).not.toBeNull();
    expect(frame.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('draws one data-point circle per hour', async () => {
    const { container } = render(<PBadChart hours={HOURS} />);
    // Recharts defers <circle> rendering until the line's animation fires
    // (default ~1500 ms), so wait for the dots to mount.
    await waitFor(
      () => {
        const dots = container.querySelectorAll('.recharts-line circle');
        expect(dots.length).toBe(HOURS.length);
      },
      { timeout: 3000 }
    );
  });

  it('marks the optimal hour as the highest-radius dot', async () => {
    render(<PBadChart hours={HOURS} optimalIso={HOURS[3].ts} />);
    // Optimal renders as two concentric circles, the larger carrying r=5.
    // Animation delays the dots, so wait for them to mount first.
    await waitFor(
      () => {
        const optimal = Array.from(
          document.querySelectorAll('.recharts-line circle')
        ).find((c) => parseFloat(c.getAttribute('r')) === 5);
        expect(optimal).toBeTruthy();
      },
      { timeout: 3000 }
    );
  });

  it('renders an empty-state when no hours are passed', () => {
    render(<PBadChart hours={[]} />);
    expect(screen.getByText(/no forecast data/i)).toBeInTheDocument();
  });

  it('renders the smooth Line series', () => {
    const { container } = render(<PBadChart hours={HOURS} />);
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull();
  });

  it('renders dashed threshold guide lines at 30% and 60%', () => {
    const { container } = render(<PBadChart hours={HOURS} />);
    const dashedReferenceLines = Array.from(
      container.querySelectorAll('.recharts-reference-line line')
    ).filter((l) => l.getAttribute('stroke-dasharray') === '4 4');
    expect(dashedReferenceLines.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes the 30% and 60% guide markers for tests', () => {
    const { container } = render(<PBadChart hours={HOURS} />);
    expect(
      container.querySelector('[data-testid="pbad-guide-warn"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pbad-guide-no-go"]')
    ).not.toBeNull();
  });

  it('summarises the best window in the chart footer when an optimum exists', () => {
    render(<PBadChart hours={HOURS} optimalIso={HOURS[3].ts} />);
    expect(screen.getByText(/best window/i)).toBeInTheDocument();
  });

  it('falls back to a "no clear best window" message when no optimum is given', () => {
    render(<PBadChart hours={HOURS} />);
    expect(screen.getByText(/no clear best window/i)).toBeInTheDocument();
  });
});





