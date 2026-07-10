import { describe, it, expect, vi } from 'vitest';
import { api } from '../api';
import * as apiModule from '../api';

describe('api client', () => {
  it('exposes all the documented endpoints used by the UI', () => {
    expect(typeof api.getSites).toBe('function');
    expect(typeof api.getForecast).toBe('function');
    expect(typeof api.getLabels).toBe('function');
    expect(typeof api.verify).toBe('function');
    expect(typeof api.getAlerts).toBe('function');
    expect(typeof api.chat).toBe('function');
    expect(typeof api.getBriefing).toBe('function');
    expect(typeof api.getExperimentResults).toBe('function');
    expect(typeof api.runExperiments).toBe('function');
    expect(typeof api.ingest).toBe('function');
  });

  it('routes requests under /api/v1', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });
    try {
      await api.health();
      expect(spy).toHaveBeenCalled();
      const calledUrl = spy.mock.calls[0][0];
      expect(calledUrl).toMatch(/\/api\/v1\/health$/);
    } finally {
      spy.mockRestore();
    }
  });
});
