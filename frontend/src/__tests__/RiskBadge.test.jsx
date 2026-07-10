import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskBadge, ProbabilityMeter } from '@/components/RiskBadge';

describe('RiskBadge', () => {
  it('renders the level text in upper case', () => {
    render(<RiskBadge risk="low" />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('emits a risk-badge-{level} test id', () => {
    render(<RiskBadge risk="LOW" />);
    expect(screen.getByTestId('risk-badge-low')).toBeInTheDocument();
  });

  it('treats "GOOD" as low', () => {
    render(<RiskBadge risk="Good" />);
    expect(screen.getByTestId('risk-badge-low')).toBeInTheDocument();
  });

  it('treats "HIGH RISK" as high', () => {
    render(<RiskBadge risk="HIGH RISK" />);
    expect(screen.getByTestId('risk-badge-high')).toBeInTheDocument();
  });

  it('treats MODERATE as moderate', () => {
    render(<RiskBadge risk="MODERATE" />);
    expect(screen.getByTestId('risk-badge-moderate')).toBeInTheDocument();
  });

  it('falls back to unknown for null', () => {
    render(<RiskBadge risk={null} />);
    expect(screen.getByTestId('risk-badge-unknown')).toBeInTheDocument();
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

  it('renders the underlying meter scaffold with high-tone tint above 60%', () => {
    const { container } = render(<ProbabilityMeter value={0.7} />);
    const fill = container.querySelector('div.bg-danger');
    expect(fill).not.toBeNull();
  });

  it('renders with positive-tone tint below 30%', () => {
    const { container } = render(<ProbabilityMeter value={0.1} />);
    const fill = container.querySelector('div.bg-positive');
    expect(fill).not.toBeNull();
  });

  it('renders with warning-tone tint between 30 and 60%', () => {
    const { container } = render(<ProbabilityMeter value={0.45} />);
    const fill = container.querySelector('div.bg-warning');
    expect(fill).not.toBeNull();
  });
});
