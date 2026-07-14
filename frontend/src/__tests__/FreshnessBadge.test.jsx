import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreshnessBadge, FreshnessStack } from '@/components/FreshnessBadge';

describe('FreshnessBadge', () => {
  it('renders live with green tone when status is "live"', () => {
    render(<FreshnessBadge descriptor={{ status: 'live', age_hours: 0.5 }} />);
    const badge = screen.getByTestId('freshness-forecast-live');
    expect(badge).toHaveAttribute('data-status', 'live');
    expect(badge.textContent).toMatch(/live/);
  });

  it('renders stale with amber tone when status is "stale"', () => {
    render(<FreshnessBadge descriptor={{ status: 'stale', age_hours: 5 }} />);
    const badge = screen.getByTestId('freshness-forecast-stale');
    expect(badge).toHaveAttribute('data-status', 'stale');
    expect(badge.textContent).toMatch(/5h/);
  });

  it('renders unavailable with muted tone when status is "unavailable"', () => {
    render(<FreshnessBadge descriptor={{ status: 'unavailable' }} />);
    const badge = screen.getByTestId('freshness-forecast-unavailable');
    expect(badge).toHaveAttribute('data-status', 'unavailable');
    expect(badge.textContent).toMatch(/unavailable/);
  });

  it('formats ages under 1 hour as minutes', () => {
    render(<FreshnessBadge descriptor={{ status: 'live', age_hours: 0.25 }} />);
    expect(screen.getByTestId('freshness-forecast-live').textContent).toMatch(/15m/);
  });

  it('formats ages over 24 hours as days', () => {
    render(<FreshnessBadge descriptor={{ status: 'stale', age_hours: 30 }} />);
    expect(screen.getByTestId('freshness-forecast-stale').textContent).toMatch(/1d/);
  });

  it('accepts a plain status string', () => {
    render(<FreshnessBadge status="live" />);
    expect(screen.getByTestId('freshness-forecast-live')).toBeInTheDocument();
  });

  it('exposes the source via data-source', () => {
    render(<FreshnessBadge descriptor={{ source: 'weather', status: 'live' }} />);
    const badge = screen.getByTestId('freshness-weather-live');
    expect(badge).toHaveAttribute('data-source', 'weather');
  });

  it('falls back to muted chip for null/undefined input', () => {
    render(<FreshnessBadge />);
    expect(screen.getByTestId('freshness-forecast-unavailable')).toBeInTheDocument();
  });
});

describe('FreshnessStack', () => {
  it('renders one badge per source', () => {
    const freshness = [
      { source: 'weather', status: 'live', age_hours: 0.5 },
      { source: 'marine', status: 'stale', age_hours: 6 },
      { source: 'tide', status: 'live', age_hours: 1 },
    ];
    render(<FreshnessStack freshness={freshness} />);
    expect(screen.getByTestId('freshness-stack')).toBeInTheDocument();
    expect(screen.getByTestId('freshness-weather-live')).toBeInTheDocument();
    expect(screen.getByTestId('freshness-marine-stale')).toBeInTheDocument();
    expect(screen.getByTestId('freshness-tide-live')).toBeInTheDocument();
  });

  it('shows a degraded summary chip when reasons are non-empty', () => {
    render(
      <FreshnessStack
        freshness={[{ source: 'weather', status: 'stale', age_hours: 12 }]}
        degradedReasons={['weather is stale']}
      />,
    );
    const chip = screen.getByTestId('freshness-degraded');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toMatch(/1 degraded/);
  });

  it('returns null when nothing to render', () => {
    const { container } = render(<FreshnessStack />);
    expect(container.firstChild).toBeNull();
  });
});