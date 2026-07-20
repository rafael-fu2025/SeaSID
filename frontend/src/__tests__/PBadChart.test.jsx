import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PBadChart from '@/components/PBadChart';

const HOURS = Array.from({ length: 6 }, (_, i) => ({
  ts: `2026-07-09T${String(i).padStart(2, '0')}:00:00+00:00`,
  p_bad: 0.1 + i * 0.1,
  risk: 'MODERATE',
}));

describe('PBadChart', () => {
  it('renders an SVG inside the chart frame', () => {
    render(<PBadChart hours={HOURS} />);
    const card = screen.getByTestId('pbad-chart');
    // The Card has 2 SVGs (lucide Activity icon + the chart). The chart is
    // tagged specifically so we can find it without ambiguity.
    const svg = card.querySelector('svg[data-testid="pbad-chart-svg"]');
    expect(svg).not.toBeNull();
  });

  it('draws one data-point circle per hour inside the chart SVG', () => {
    render(<PBadChart hours={HOURS} />);
    const svg = screen.getByTestId('pbad-chart').querySelector('svg[data-testid="pbad-chart-svg"]');
    const circles = svg.querySelectorAll('circle');
    expect(circles).toHaveLength(HOURS.length);
  });

  it('marks the optimal hour as the highest-radius dot in the chart SVG', () => {
    render(<PBadChart hours={HOURS} optimalIso={HOURS[3].ts} />);
    const svg = screen.getByTestId('pbad-chart').querySelector('svg[data-testid="pbad-chart-svg"]');
    const circles = Array.from(svg.querySelectorAll('circle'));
    const opt = circles.find((c) => parseFloat(c.getAttribute('r')) === 5);
    expect(opt).toBeTruthy();
  });

  it('renders an empty-state when no hours are passed', () => {
    render(<PBadChart hours={[]} />);
    expect(screen.getByText(/no forecast data/i)).toBeInTheDocument();
  });

  it('draws one column bar per hour with a risk-coloured fill', () => {
    render(<PBadChart hours={HOURS} />);
    const svg = screen.getByTestId('pbad-chart').querySelector('svg[data-testid="pbad-chart-svg"]');
    // The redesigned chart uses <rect> elements for each hour column, plus
    // three background band rects. With six hours we expect 9 rects total.
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(HOURS.length + 3);
  });

  it('renders threshold guide lines anchored at 30% and 60%', () => {
    render(<PBadChart hours={HOURS} />);
    const svg = screen.getByTestId('pbad-chart').querySelector('svg[data-testid="pbad-chart-svg"]');
    // Two dashed guide lines + subtle 5/4-tick gridlines = 7 lines.
    const guides = svg.querySelectorAll('line[stroke-dasharray="4 4"]');
    expect(guides.length).toBe(2);
  });

  it('shows the optimal hour as a labelled badge above its column', () => {
    render(<PBadChart hours={HOURS} optimalIso={HOURS[3].ts} />);
    // The Optimal pill above the bar uses an <rect> + <text> pair.
    const svg = screen.getByTestId('pbad-chart').querySelector('svg[data-testid="pbad-chart-svg"]');
    const pillText = Array.from(svg.querySelectorAll('text')).find(
      (t) => (t.textContent || '').toLowerCase() === 'optimal'
    );
    expect(pillText).toBeTruthy();
  });

  it('renders the Optimal pill wide enough to fit the full label', () => {
    render(<PBadChart hours={HOURS} optimalIso={HOURS[3].ts} />);
    const svg = screen.getByTestId('pbad-chart').querySelector('svg[data-testid="pbad-chart-svg"]');
    // Find the pill rect (rounded, fill-reef, near the top of the chart).
    const pillRect = Array.from(svg.querySelectorAll('rect')).find((r) => {
      const cls = r.getAttribute('class') || '';
      const w = parseFloat(r.getAttribute('width'));
      return cls.includes('fill-reef') && cls.includes('stroke-reef') && w >= 64;
    });
    expect(pillRect).toBeTruthy();
    // The full label "Optimal" must be present in the <text> + the rect must
    // be wide enough that the centered uppercase tracking-wider text fits.
    expect(parseFloat(pillRect.getAttribute('width'))).toBeGreaterThanOrEqual(72);
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
