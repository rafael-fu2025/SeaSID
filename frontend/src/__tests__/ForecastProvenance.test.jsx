import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ForecastProvenance } from '@/components/ForecastProvenance';

const baseProps = {
  dataAsOf: '2026-07-22T07:00:00+00:00',
  freshness: [
    { source: 'weather', status: 'unavailable' },
    { source: 'marine',  status: 'live', age_hours: 0.02 },
    { source: 'air',     status: 'unavailable' },
  ],
  providers: { weather: 'open_meteo', marine: 'stormglass', air: 'aqicn' },
  modelVersion: 'rules-fallback-v1 (rule-based: no ML bundle qualified its tier gate)',
  generatedAt: '2026-07-19T21:00:00+00:00',
};

describe('ForecastProvenance', () => {
  it('renders a two-section panel (Data sources + Forecast metadata)', () => {
    render(<ForecastProvenance {...baseProps} />);
    const panel = screen.getByTestId('forecast-provenance');
    expect(panel).toBeInTheDocument();

    const sources = screen.getByTestId('provenance-section-sources');
    expect(within(sources).getByText(/data sources/i)).toBeInTheDocument();
    const metadata = screen.getByTestId('provenance-section-metadata');
    expect(within(metadata).getByText(/forecast metadata/i)).toBeInTheDocument();
  });

  it('renders each freshness source as a labelled row with its badge', () => {
    render(<ForecastProvenance {...baseProps} />);
    const sources = screen.getByTestId('provenance-section-sources');
    // Role labels are present, capitalized.
    expect(within(sources).getByText(/weather/i)).toBeInTheDocument();
    expect(within(sources).getByText(/marine/i)).toBeInTheDocument();
    expect(within(sources).getByText(/air/i)).toBeInTheDocument();
    // The freshness badges keep their existing data-testids so other tests are not broken.
    expect(screen.getByTestId('freshness-weather-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('freshness-marine-live')).toBeInTheDocument();
    expect(screen.getByTestId('freshness-air-unavailable')).toBeInTheDocument();
  });

  it('lists each provider on its own sub-row inside the metadata grid', () => {
    render(<ForecastProvenance {...baseProps} />);
    const providersCell = screen.getByTestId('provenance-providers');
    // Each role is rendered in its own line with the provider name adjacent.
    expect(within(providersCell).getByText('open_meteo')).toBeInTheDocument();
    expect(within(providersCell).getByText('stormglass')).toBeInTheDocument();
    expect(within(providersCell).getByText('aqicn')).toBeInTheDocument();
    // Role labels are visible too.
    expect(within(providersCell).getAllByText(/weather/i).length).toBeGreaterThan(0);
    expect(within(providersCell).getAllByText(/marine/i).length).toBeGreaterThan(0);
    expect(within(providersCell).getAllByText(/air/i).length).toBeGreaterThan(0);
  });

  it('renders data_as_of, model, and generated timestamps in the metadata grid', () => {
    render(<ForecastProvenance {...baseProps} />);
    const metadata = screen.getByTestId('provenance-section-metadata');
    // Data as of → UTC timestamp.
    expect(within(metadata).getByTestId('provenance-data-as-of').textContent).toMatch(/UTC/);
    // Model label.
    expect(within(metadata).getByTestId('provenance-model').textContent).toMatch(/rules-fallback-v1/);
    // Generated label only appears when generatedAt differs from dataAsOf.
    expect(within(metadata).getByTestId('provenance-generated-at').textContent).toMatch(/UTC/);
  });

  it('omits the Generated row when generatedAt equals dataAsOf', () => {
    render(<ForecastProvenance {...baseProps} generatedAt={baseProps.dataAsOf} />);
    expect(screen.queryByTestId('provenance-generated-at')).not.toBeInTheDocument();
  });

  it('omits the Model row when modelVersion is not provided', () => {
    const { modelVersion, ...rest } = baseProps;
    render(<ForecastProvenance {...rest} />);
    expect(screen.queryByTestId('provenance-model')).not.toBeInTheDocument();
  });

  it('shows a graceful empty-state when no freshness descriptors are passed', () => {
    const { freshness, ...rest } = baseProps;
    render(<ForecastProvenance {...rest} freshness={[]} />);
    expect(screen.getByText(/no source data reported/i)).toBeInTheDocument();
  });

  it('compact mode keeps the same structure but tighter typography', () => {
    render(<ForecastProvenance {...baseProps} compact />);
    // No regressions in testids, just slimmer typography.
    expect(screen.getByTestId('provenance-data-as-of')).toBeInTheDocument();
    expect(screen.getByTestId('provenance-model')).toBeInTheDocument();
    expect(screen.getByTestId('provenance-providers')).toBeInTheDocument();
  });
});
