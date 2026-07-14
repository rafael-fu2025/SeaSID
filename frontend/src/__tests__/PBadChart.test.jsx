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

  it('labels the chart using the supplied horizon', () => {
    render(<PBadChart hours={HOURS} />);
    expect(screen.getByText(/probability of no-go · 6 hours/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '6-hour P(no-go) chart' })).toBeInTheDocument();
  });
});
