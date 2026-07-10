import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ForecastCard from '../components/ForecastCard';

const HOUR = {
  ts: '2026-07-09T12:00:00+00:00',
  viz_label: 'Good',
  current_risk: 'Low',
  p_bad: 0.12,
  risk: 'LOW',
  model_used: 'rule_based',
};

describe('ForecastCard', () => {
  it('shows the visibility and current labels', () => {
    render(<ForecastCard hour={HOUR} />);
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('renders the probability as a percentage with a known class', () => {
    render(<ForecastCard hour={HOUR} />);
    const el = document.querySelector('.hour-card__p');
    expect(el).not.toBeNull();
    expect(el.textContent).toMatch(/12%/);
    expect(el.className).toMatch(/hour-card__p--low/);
  });

  it('uses the high-color class above 60%', () => {
    render(<ForecastCard hour={{ ...HOUR, p_bad: 0.75 }} />);
    const el = document.querySelector('.hour-card__p');
    expect(el.className).toMatch(/hour-card__p--high/);
  });

  it('renders nothing for a null hour', () => {
    const { container } = render(<ForecastCard hour={null} />);
    expect(container.firstChild).toBeNull();
  });
});
