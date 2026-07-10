const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Health
  health: () => request('/api/v1/health'),

  // Sites
  getSites: () => request('/api/v1/sites'),

  // Forecast
  getForecast: (siteKey) => request(`/api/v1/forecast?site=${siteKey}`),

  // Labels
  getLabels: (siteKey = 'all', limit = 50) =>
    request(`/api/v1/labels?site=${siteKey}&limit=${limit}`),

  // Ingest
  ingest: (siteKey, hours = 48) =>
    request('/api/v1/ingest', {
      method: 'POST',
      body: JSON.stringify({ site_key: siteKey, hours }),
    }),

  // Verify
  verify: (data) =>
    request('/api/v1/verify', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Alerts
  getAlerts: (siteKey, hours = 24) => {
    const params = new URLSearchParams({ hours });
    if (siteKey) params.set('site', siteKey);
    return request(`/api/v1/alerts?${params}`);
  },

  // Agent
  chat: (message, conversationId, siteKey) =>
    request('/api/v1/agent/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        site_key: siteKey,
      }),
    }),

  getBriefing: (siteKey) => request(`/api/v1/agent/briefing?site=${siteKey}`),

  // Experiments
  getExperimentResults: () => request('/api/v1/experiments/results'),
  runExperiments: () => request('/api/v1/experiments/run', { method: 'POST' }),
};
