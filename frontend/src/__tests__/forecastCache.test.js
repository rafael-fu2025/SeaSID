import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearForecastCache,
  FORECAST_CACHE_TTL_MS,
  readForecastCache,
  writeForecastCache,
} from '@/lib/forecastCache';

describe('forecast cache', () => {
  beforeEach(() => window.localStorage.clear());

  it('restores a fresh site-specific forecast', () => {
    writeForecastCache('dauin_muck', { forecast: { hours: [1] }, briefing: {} }, 1_000);
    expect(readForecastCache('dauin_muck', 2_000)?.forecast.hours).toEqual([1]);
  });

  it('expires stale entries and removes them', () => {
    writeForecastCache('apo_island', { forecast: {} }, 1_000);
    expect(readForecastCache('apo_island', 1_000 + FORECAST_CACHE_TTL_MS + 1)).toBeNull();
  });

  it('can invalidate a site for an explicit refresh', () => {
    writeForecastCache('dauin_muck', { forecast: {} });
    clearForecastCache('dauin_muck');
    expect(readForecastCache('dauin_muck')).toBeNull();
  });
});
