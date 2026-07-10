import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskBadge, ProbabilityMeter } from '../components/RiskBadge';

describe('RiskBadge', () => {
  it('renders the risk text', () => {
    render(<RiskBadge risk="LOW" />);
    expect(screen.getByText('LOW')).toBeInTheDocument();
  });

  it('renders low for "LOW" and "GOOD" inputs', () => {
    const { rerender } = render(<RiskBadge risk="LOW" />);
    expect(screen.getByTestId('risk-badge').dataset.level).toBe('low');
    rerender(<RiskBadge risk="Good" />);
    expect(screen.getByTestId('risk-badge').dataset.level).toBe('low');
  });

  it('renders high for "HIGH RISK"', () => {
    render(<RiskBadge risk="HIGH RISK" />);
    expect(screen.getByTestId('risk-badge').dataset.level).toBe('high');
  });

  it('renders moderate for "MODERATE"', () => {
    render(<RiskBadge risk="MODERATE" />);
    expect(screen.getByTestId('risk-badge').dataset.level).toBe('moderate');
  });

  it('renders unknown for empty input', () => {
    render(<RiskBadge risk={null} />);
    expect(screen.getByTestId('risk-badge').dataset.level).toBe('unknown');
  });
});

describe('ProbabilityMeter', () => {
  it('shows the percentage text', () => {
    render(<ProbabilityMeter value={0.42} />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('clamps values outside [0, 1] and still renders', () => {
    const { rerender } = render(<ProbabilityMeter value={1.5} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    rerender(<ProbabilityMeter value={-0.5} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('uses the high-level fill above 60%', () => {
    render(<ProbabilityMeter value={0.7} />);
    expect(document.querySelector('.prob-meter__fill--high')).not.toBeNull();
  });
});
