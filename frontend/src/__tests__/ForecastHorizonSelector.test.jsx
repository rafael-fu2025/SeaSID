import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ForecastHorizonSelector from '@/components/ForecastHorizonSelector';

describe('ForecastHorizonSelector', () => {
  it('offers 12, 24, and 48-hour horizons', () => {
    render(<ForecastHorizonSelector value={12} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '12h' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '24h' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '48h' })).toBeInTheDocument();
  });

  it('reports the selected horizon', () => {
    const onChange = vi.fn();
    render(<ForecastHorizonSelector value={12} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '48h' }));
    expect(onChange).toHaveBeenCalledWith(48);
  });
});
