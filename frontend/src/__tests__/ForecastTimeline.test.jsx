import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ForecastTimeline, { groupForecastHoursByDay } from '@/components/ForecastTimeline';

const HOURS = [
  { ts: '2026-07-15T22:00:00', p_bad: 0.4, current_risk: 'Low', viz_label: 'Good' },
  { ts: '2026-07-15T23:00:00', p_bad: 0.3, current_risk: 'Low', viz_label: 'Good' },
  { ts: '2026-07-16T00:00:00', p_bad: 0.2, current_risk: 'Low', viz_label: 'Good' },
];

describe('ForecastTimeline', () => {
  it('groups consecutive forecast hours by local calendar date', () => {
    const groups = groupForecastHoursByDay(HOURS);
    expect(groups).toHaveLength(2);
    expect(groups[0].hours).toHaveLength(2);
    expect(groups[1].hours).toHaveLength(1);
  });

  it('renders date summaries and all hourly cards', () => {
    render(<ForecastTimeline hours={HOURS} optimalIso={HOURS[2].ts} />);
    expect(screen.getByTestId('forecast-timeline')).toBeInTheDocument();
    expect(screen.getAllByText(/hourly updates/i)).toHaveLength(2);
    expect(screen.getAllByTestId('forecast-card')).toHaveLength(3);
    expect(screen.getAllByText(/best window/i)).toHaveLength(2);
  });
});
