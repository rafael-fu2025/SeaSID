import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ForecastCard from '@/components/ForecastCard';

const HOUR = {
  ts: '2026-07-09T12:00:00+00:00',
  viz_label: 'Good',
  current_risk: 'low',
  p_bad: 0.12,
  model_used: 'rule_based',
};

function renderCard(hour = HOUR) {
  return render(<ForecastCard hour={hour} />);
}

describe('ForecastCard', () => {
  it('shows the visibility label and the current risk badge', () => {
    renderCard();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByTestId('risk-badge-low')).toBeInTheDocument();
  });

  it('renders the probability as a percentage text', () => {
    renderCard();
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('uses the danger class for P(no-go) >= 60%', () => {
    renderCard({ ...HOUR, p_bad: 0.75 });
    const meter = document.querySelector('div.bg-danger');
    expect(meter).not.toBeNull();
  });

  it('uses the positive class for P(no-go) < 30%', () => {
    renderCard({ ...HOUR, p_bad: 0.12 });
    const meter = document.querySelector('div.bg-positive');
    expect(meter).not.toBeNull();
  });

  it('uses the warning class for P(no-go) 30..60%', () => {
    renderCard({ ...HOUR, p_bad: 0.45 });
    const meter = document.querySelector('div.bg-warning');
    expect(meter).not.toBeNull();
  });

  it('renders the card root with a data-testid', () => {
    renderCard();
    expect(screen.getByTestId('forecast-card')).toBeInTheDocument();
  });

  it('marks the optimal hour with data-optimal=true', () => {
    render(<ForecastCard hour={HOUR} isOptimal />);
    expect(screen.getByTestId('forecast-card').getAttribute('data-optimal')).toBe('true');
  });

  it('renders nothing for a null hour', () => {
    const { container } = render(<ForecastCard hour={null} />);
    expect(container.firstChild).toBeNull();
  });
});
